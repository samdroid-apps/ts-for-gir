import type {
    GenerateConfig,
    InheritanceTable,
    GirClassElement,
    GirCallableParamElement,
    GirSignalElement,
    GirEnumElement,
    GirAliasElement,
    GirInterfaceElement,
    GirUnionElement,
    GirModulesGrouped,
    GirRecordElement,
    GirBitfieldElement,
    GirInstanceParameter,
    TsGenericParameter,
    TsType,
    TsDoc,
    TsFunction,
    TsCallback,
    TsSignal,
    TsMember,
    TsVar,
    TsProperty,
    TsParameter,
    TypeGirElement,
} from './types/index.js'
import { Generator } from './generator.js'
import type { GirModule } from './gir-module.js'
import TemplateProcessor from './template-processor.js'
import { Logger } from './logger.js'
import {
    generateIndent,
    findFileInDirs,
    splitModuleName,
    removeNamespace,
    girElementIsIntrospectable,
    typeIsOptional,
} from './utils.js'
import {
    NO_TSDATA,
    WARN_NOT_FOUND_DEPENDENCY_GIR_FILE,
    WARN_IGNORE_MULTIPLE_CALLBACKS,
    WARN_IGNORE_MULTIPLE_FUNC_DESC,
} from './messages.js'

export default class TypeDefinitionGenerator implements Generator {
    protected log: Logger
    constructor(protected readonly config: GenerateConfig) {
        this.log = new Logger(config.environment, config.verbose, TypeDefinitionGenerator.name)
    }

    /**
     *
     * @param namespace E.g. 'Gtk'
     * @param packageName E.g. 'Gtk-3.0'
     * @param asExternType Currently only used for node type imports
     */
    private generateModuleDependenciesImport(namespace: string, packageName: string, asExternType = false): string[] {
        const def: string[] = []
        if (this.config.buildType === 'lib') {
            const sas = this.config.useNamespace && packageName !== 'Gjs' ? '' : '* as '
            def.push(`import type ${sas}${namespace} from './${packageName}';`)
        } else if (this.config.buildType === 'types') {
            if (asExternType) {
                // def.push(`/// <reference types="${packageName}" />`)
                def.push(`import ${namespace} from "${packageName}"`)
            } else {
                def.push(`/// <reference path="${packageName}.d.ts" />`)
                def.push(`import type ${namespace} from './${packageName}';`)
            }
        }
        return def
    }

    private generateExport(type: string, name: string, definition: string, indentCount = 0) {
        const exp = this.config.useNamespace || this.config.buildType === 'types' ? '' : 'export '
        const indent = generateIndent(indentCount)
        if (!definition.startsWith(':')) {
            definition = ' ' + definition
        }
        return `${indent}${exp}${type} ${name}${definition}`
    }

    private generateProperty(tsProp: TsProperty, onlyStatic: boolean, namespace: string, indentCount = 0) {
        if (!tsProp) {
            throw new Error('[generateProperty] Not all required properties set!')
        }

        const desc: string[] = []
        const isStatic = tsProp.isStatic

        if ((isStatic && !onlyStatic) || (!isStatic && onlyStatic)) {
            return desc
        }

        desc.push(...this.addGirDocComment(tsProp.doc, indentCount))

        const indent = generateIndent(indentCount)
        const varDesc = this.generateVariable(tsProp, namespace, 0, false)
        const staticStr = isStatic ? 'static ' : ''
        const readonly = tsProp.readonly ? 'readonly ' : ''

        // temporary solution, will be solved differently later
        const commentOut = tsProp.hasUnresolvedConflict ? '// TODO fix conflict: ' : ''

        desc.push(`${indent}${commentOut}${staticStr}${readonly}${varDesc}`)
        return desc
    }

    private generateProperties(
        tsProps: TsProperty[],
        onlyStatic: boolean,
        namespace: string,
        comment: string,
        indentCount = 0,
    ) {
        const def: string[] = []
        for (const tsProp of tsProps) {
            def.push(...this.generateProperty(tsProp, onlyStatic, namespace, indentCount))
        }

        if (def.length > 0) {
            def.unshift(...this.addInfoComment(comment, indentCount))
        }

        return def
    }

    private generateVariableCallbackType(tsType: TsType, namespace: string) {
        // The type of a callback is a functions definition

        let typeStr = 'any'

        const { callbacks } = tsType

        if (!callbacks.length) return typeStr

        if (callbacks.length > 1) {
            this.log.warn(WARN_IGNORE_MULTIPLE_CALLBACKS)
        }

        const girCallback = callbacks[0]

        if (!girCallback._tsData) {
            throw new Error(NO_TSDATA('generateVariableCallbackType'))
        }

        const funcDesc = this.generateFunction(girCallback._tsData, false, namespace, 0)

        if (girCallback._tsData && funcDesc?.length) {
            if (funcDesc.length > 1) {
                this.log.warn(WARN_IGNORE_MULTIPLE_FUNC_DESC)
            }
            typeStr = funcDesc[0]
        }

        return typeStr
    }

    private generateVariable(tsVar: TsProperty | TsVar, namespace: string, indentCount = 0, allowCommentOut = true) {
        const indent = generateIndent(indentCount)
        const name = tsVar.name
        const optional = typeIsOptional(tsVar.type)

        if (!name) {
            throw new Error('[generateVariable] "name" not set!')
        }

        const affix = optional ? '?' : ''
        const typeStr = this.generateTypes(tsVar.type, namespace, tsVar.girTypeName)

        // temporary solution, will be solved differently later
        const commentOut = allowCommentOut && tsVar.hasUnresolvedConflict ? '// TODO fix conflict: ' : ''

        return `${indent}${commentOut}${name}${affix}: ${typeStr}`
    }

    private generateTypes(tsTypes: TsType[], namespace: string, girTypeName: TypeGirElement) {
        const separator = girTypeName === 'field' || girTypeName === 'property' ? ' & ' : ' | '
        return tsTypes.map((tsType) => this.generateType(tsType, namespace)).join(separator)
    }

    private generateType(tsType: TsType, namespace: string) {
        let typeName = removeNamespace(tsType.type, namespace)

        if (tsType.callbacks.length) {
            typeName = this.generateVariableCallbackType(tsType, namespace)
        }

        if (!typeName) {
            throw new Error('[generateVariable] "typeName" not set!')
        }

        let prefix = tsType.isArray ? '[]' : ''
        prefix += tsType.nullable ? ' | null' : ''

        const genericValues = tsType.generics.map((g) => g.value).filter((g) => !!g)
        const generics = tsType.generics.length ? `<${genericValues.join(', ')}>` : ''

        return `${typeName}${generics}${prefix}`
    }

    /**
     * Generates signals from all properties of a base class
     * TODO: Build new GirSignalElements instead of generate the strings directly
     * @param girClass
     * @param namespace
     * @param indentCount
     * @returns
     */
    private generateClassPropertySignals(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
        indentCount = 1,
    ) {
        const def: string[] = []

        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateConstructPropsInterface'))
        }

        if (girClass._tsData?.isDerivedFromGObject) {
            if (girClass._tsData.propertySignalMethods.length > 0) {
                def.push(
                    ...this.addInfoComment(
                        `Class property signals of ${girClass._module?.packageName}.${girClass._fullSymName}`,
                        indentCount,
                    ),
                )
                for (const tsSignalMethod of girClass._tsData.propertySignalMethods) {
                    if (!tsSignalMethod) {
                        // this.log.warn(NO_TSDATA('generateClassPropertySignals'))
                        continue
                    }
                    def.push(...this.generateFunction(tsSignalMethod, false, namespace, indentCount))
                }
            }
        }
        return def
    }

    private generateInParameters(
        inParams: GirCallableParamElement[],
        instanceParameters: GirInstanceParameter[],
        namespace: string,
    ) {
        const inParamsDef: string[] = []

        // TODO: Should use of a constructor, and even of an instance, be discouraged?
        for (const instanceParameter of instanceParameters) {
            if (instanceParameter._tsData) {
                let { structFor } = instanceParameter._tsData
                const { name } = instanceParameter._tsData
                const gobject = namespace === 'GObject' || namespace === 'GLib' ? '' : 'GObject.'

                structFor = removeNamespace(structFor, namespace)

                const returnTypes = [structFor, 'Function', `${gobject}GType`]
                inParamsDef.push(`${name}: ${returnTypes.join(' | ')}`)
            }
        }

        for (const inParam of inParams) {
            if (inParam._tsData) inParamsDef.push(...this.generateParameter(inParam._tsData, namespace))
        }

        return inParamsDef
    }

    private generateSignals(
        girSignals: GirSignalElement[],
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
        indentCount = 0,
    ) {
        const def: string[] = []

        for (const girSignal of girSignals) {
            if (girSignal._tsData?.tsMethods?.length) {
                for (const tsSignalMethod of girSignal._tsData?.tsMethods) {
                    if (!tsSignalMethod) {
                        // this.log.warn(NO_TSDATA('generateClassPropertySignals'))
                        continue
                    }
                    def.push(...this.generateFunction(tsSignalMethod, false, namespace, indentCount))
                }
            }
        }
        return def
    }

    /**
     * Adds documentation comments
     * @see https://github.com/microsoft/tsdoc
     * @param lines
     * @param indentCount
     */
    private addTSDocCommentLines(lines: string[], indentCount = 0): string[] {
        const def: string[] = []
        const indent = generateIndent(indentCount)
        def.push(`${indent}/**`)
        for (const line of lines) {
            def.push(`${indent} * ${line}`)
        }
        def.push(`${indent} */`)
        return def
    }

    /**
     * Adds the documentation as comments
     * @see https://github.com/microsoft/tsdoc
     * @param girDoc
     * @param indentCount
     * @param overwriteDoc
     * @returns
     */
    private addGirDocComment(tsDoc: TsDoc | undefined, indentCount = 0, overwriteDoc?: Partial<TsDoc>) {
        const desc: string[] = []
        const indent = generateIndent(indentCount)
        if (this.config.noComments) {
            return desc
        }

        const text = overwriteDoc?.text || tsDoc?.text
        const tags = overwriteDoc?.tags || tsDoc?.tags || []

        if (text) {
            desc.push(`${indent}/**`)

            if (text) {
                const lines = text.split('\n')
                if (lines.length) {
                    for (const line of lines) {
                        desc.push(`${indent} * ${line}`)
                    }
                }
            }

            for (const tag of tags) {
                if (tag.paramName) {
                    desc.push(`${indent} * @${tag.tagName} ${tag.paramName} ${tag.text}`)
                } else {
                    desc.push(`${indent} * @${tag.tagName} ${tag.text}`)
                }
            }
            desc.push(`${indent} */`)
        }
        return desc
    }

    /**
     * Adds an info comment, is used for debugging the generated types
     * @param comment
     * @param indentCount
     * @returns
     */
    private addInfoComment(comment?: string, indentCount = 0) {
        const def: string[] = []
        if (this.config.noDebugComments) {
            return def
        }
        const indent = generateIndent(indentCount)
        if (comment) {
            def.push('')
            def.push(`${indent}// ${comment}`)
            def.push('')
        }
        return def
    }

    /**
     * Adds an inline info comment, is used for debugging the generated types
     * @param comment
     * @param indentCount
     * @returns
     */
    private addInlineInfoComment(comment?: string, indentCount = 0) {
        const def: string[] = []
        if (this.config.noDebugComments) {
            return def
        }
        const indent = generateIndent(indentCount)
        if (comment) {
            def.push(`${indent}/* ${comment} */`)
        }
        return def
    }

    private mergeDescs(descs: string[], comment?: string, indentCount = 1) {
        const def: string[] = []
        const indent = generateIndent(indentCount)

        for (const desc of descs) {
            def.push(`${indent}${desc}`)
        }

        if (def.length > 0) {
            def.unshift(...this.addInfoComment(comment, indentCount))
        }

        return def
    }

    private generateParameter(tsParam: TsParameter, namespace: string) {
        if (typeof tsParam?.name !== 'string') {
            throw new Error(NO_TSDATA('generateParameter'))
        }

        const types = tsParam.type
        const name = tsParam.name
        const typeStr = this.generateTypes(types, namespace, tsParam.girTypeName)
        const optional = typeIsOptional(types) && !tsParam.isRest
        const affix = optional ? '?' : ''
        const prefix = tsParam.isRest ? '...' : ''

        return [`${prefix}${name}${affix}: ${typeStr}`]
    }

    /**
     *
     * @param tsGenerics
     * @param isOut If this generic parameters are out do only generate the type parameter names
     * @returns
     */
    private generateGenericParameters(tsGenerics?: TsGenericParameter[], isOut = false) {
        const desc: string[] = []
        if (!tsGenerics?.length) {
            return ''
        }

        for (const tsGeneric of tsGenerics) {
            if (!tsGeneric.name) {
                continue
            }
            let genericStr = `${tsGeneric.name}`
            if (!isOut && tsGeneric.extends) {
                genericStr += ` extends ${tsGeneric.extends}`
            }
            if (!isOut && tsGeneric.value) {
                genericStr += ` = ${tsGeneric.value}`
            }
            desc.push(genericStr)
        }

        return `<${desc.join(', ')}>`
    }

    private generateOutParameterReturn(girParam: GirCallableParamElement, namespace: string) {
        const desc: string[] = []

        if (!girParam._tsData) {
            this.log.warn(NO_TSDATA('generateOutParameterReturn'))
            return desc
        }

        const { name } = girParam._tsData
        const typeStr = this.generateTypes(girParam._tsData.type, namespace, girParam._tsData.girTypeName)

        desc.push(`/* ${name} */ ${typeStr}`)
        return desc
    }

    private generateFunctionReturn(tsFunction: TsFunction | TsCallback | TsSignal, namespace: string) {
        if (tsFunction.name === 'constructor') {
            return ''
        }

        const overrideReturnType = tsFunction.overrideReturnType
        const outParams = tsFunction.outParams
        const retTypeIsVoid = tsFunction.retTypeIsVoid
        const typeStr = this.generateTypes(tsFunction.returnTypes, namespace, tsFunction.girTypeName)

        let desc = typeStr

        if (overrideReturnType) {
            desc = removeNamespace(overrideReturnType, namespace)
        } else if (outParams.length + (retTypeIsVoid ? 0 : 1) > 1) {
            const outParamsDesc: string[] = []

            if (!retTypeIsVoid) {
                outParamsDesc.push(`/* returnType */ ${typeStr}`)
            }

            for (const outParam of outParams) {
                outParamsDesc.push(...this.generateOutParameterReturn(outParam, namespace))
            }

            desc = outParamsDesc.join(', ')
            desc = `[ ${desc} ]`
        } else if (outParams.length === 1 && retTypeIsVoid) {
            desc = this.generateOutParameterReturn(outParams[0], namespace).join(' ')
        }

        return desc
    }

    private generateFunction(
        tsFunction: TsFunction | TsCallback | TsSignal | undefined,
        /** If true only generate static functions otherwise generate only non static functions */
        onlyStatic: boolean,
        namespace: string,
        indentCount = 1,
        overloads = true,
    ) {
        const def: string[] = []
        const indent = generateIndent(indentCount)

        if (!tsFunction) {
            this.log.warn(NO_TSDATA('generateFunction'))
            return def
        }

        let { name } = tsFunction
        const { isStatic } = tsFunction

        const { isArrowType, isGlobal, inParams, instanceParameters } = tsFunction

        if ((isStatic && !onlyStatic) || (!isStatic && onlyStatic)) {
            return def
        }

        if (tsFunction.doc) def.push(...this.addGirDocComment(tsFunction.doc, indentCount))

        const staticStr = isStatic && tsFunction.name !== 'constructor' ? 'static ' : ''

        const globalStr = isGlobal ? 'function ' : ''
        const genericStr = this.generateGenericParameters(tsFunction.generics)

        // temporary solution, will be solved differently later
        const commentOut = tsFunction.hasUnresolvedConflict ? '// TODO fix conflict: ' : ''

        let exportStr = ''
        // `tsType === 'function'` are a global methods which can be exported
        if (isGlobal) {
            exportStr = this.config.useNamespace || this.config.buildType === 'types' ? '' : 'export '
        }

        const returnType = this.generateFunctionReturn(tsFunction, namespace)

        let retSep = ''
        if (returnType) {
            if (isArrowType) {
                name = ''
                retSep = ' =>'
            } else {
                retSep = ':'
            }
        }

        const inParamsDef: string[] = this.generateInParameters(inParams, instanceParameters, namespace)

        def.push(
            `${indent}${commentOut}${exportStr}${staticStr}${globalStr}${name}${genericStr}(${inParamsDef.join(
                ', ',
            )})${retSep} ${returnType}`,
        )

        // Add overloaded methods
        if (overloads && tsFunction.overloads.length > 0) {
            def.push(...this.addInfoComment(`Overloads of ${name}`, indentCount))
            for (const func of tsFunction.overloads) {
                def.push(...this.generateFunction(func, onlyStatic, namespace, indentCount, false))
            }
        }

        return def
    }

    private generateFunctions(
        tsFunctions: TsFunction[],
        onlyStatic: boolean,
        namespace: string,
        indentCount = 1,
        comment?: string,
    ) {
        const def: string[] = []

        for (const girFunction of tsFunctions) {
            def.push(...this.generateFunction(girFunction, onlyStatic, namespace, indentCount))
        }

        if (def.length > 0) {
            def.unshift(...this.addInfoComment(comment, indentCount))
        }

        return def
    }

    private generateCallbackInterface(tsCallback: TsCallback | TsSignal, namespace: string, indentCount = 0) {
        const def: string[] = []

        if (!tsCallback?.tsCallbackInterface) {
            this.log.warn(NO_TSDATA('generateCallbackInterface'))
            return def
        }

        def.push(...this.addGirDocComment(tsCallback.doc, indentCount, tsCallback.tsCallbackInterface.overwriteDoc))

        const indent = generateIndent(indentCount)
        const indentBody = generateIndent(indentCount + 1)
        const { inParams, instanceParameters } = tsCallback
        const returnTypeStr = this.generateTypes(tsCallback.returnTypes, namespace, tsCallback.girTypeName)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { name } = tsCallback.tsCallbackInterface
        const inParamsDef: string[] = this.generateInParameters(inParams, instanceParameters, namespace)

        def.push(indent + this.generateExport('interface', name, '{', indentCount))
        def.push(`${indentBody}(${inParamsDef.join(', ')}): ${returnTypeStr}`)
        def.push(indent + '}')

        return def
    }

    private generateEnumeration(girEnum: GirEnumElement | GirBitfieldElement, indentCount = 0) {
        const desc: string[] = []

        if (!girElementIsIntrospectable(girEnum)) {
            return desc
        }

        if (!girEnum._tsData) {
            this.log.warn(NO_TSDATA('generateEnumeration'))
            return desc
        }

        desc.push(...this.addGirDocComment(girEnum._tsData.doc, indentCount))

        const { name } = girEnum._tsData
        desc.push(this.generateExport('enum', name, '{', indentCount))
        if (girEnum.member) {
            for (const girEnumMember of girEnum.member) {
                if (!girEnumMember._tsData) continue
                desc.push(...this.generateEnumerationMember(girEnumMember._tsData, indentCount + 1))
            }
        }
        desc.push('}')
        return desc
    }

    private generateEnumerationMember(tsMember: TsMember, indentCount = 1) {
        const desc: string[] = []

        if (!tsMember) {
            this.log.warn(NO_TSDATA('generateEnumerationMember'))
            return desc
        }

        desc.push(...this.addGirDocComment(tsMember.doc, indentCount))

        const indent = generateIndent(indentCount)
        desc.push(`${indent}${tsMember.name},`)
        return desc
    }

    private generateConstant(tsConst: TsVar, namespace: string, indentCount = 0) {
        const desc: string[] = []

        desc.push(...this.addGirDocComment(tsConst.doc, indentCount))

        const indent = generateIndent(indentCount)
        const exp = this.config.useNamespace || this.config.buildType === 'types' ? '' : 'export '
        const varDesc = this.generateVariable(tsConst, namespace, 0)
        desc.push(`${indent}${exp}const ${varDesc}`)
        return desc
    }

    private generateAlias(girAlias: GirAliasElement, namespace: string, indentCount = 0) {
        const desc: string[] = []

        if (!girElementIsIntrospectable(girAlias)) {
            return ''
        }

        if (!girAlias._tsData) {
            this.log.warn(NO_TSDATA('generateAlias'))
            return desc
        }
        const indent = generateIndent(indentCount)

        const exp = this.config.useNamespace || this.config.buildType === 'types' ? '' : 'export '
        const type = removeNamespace(girAlias._tsData.type, namespace)

        desc.push(`${indent}${exp}type ${girAlias._tsData.name} = ${type}`)
        return desc
    }

    private generateConstructPropsInterface(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
        indentCount = 0,
    ) {
        const def: string[] = []

        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateConstructPropsInterface'))
        }

        if (!girClass._tsData.isDerivedFromGObject) {
            return def
        }

        const indent = generateIndent(indentCount)
        const exp = this.config.useNamespace || this.config.buildType === 'types' ? '' : 'export '
        let ext = ' '

        if (girClass._tsData.inheritConstructPropInterfaceNames.length) {
            const constructPropInterfaceNames = girClass._tsData.inheritConstructPropInterfaceNames.map((n) =>
                removeNamespace(n, namespace),
            )
            ext = `${indent}extends ${constructPropInterfaceNames.join(', ')} `
        }

        const constructPropInterfaceName = removeNamespace(girClass._tsData.constructPropInterfaceName, namespace)

        def.push(`${indent}${exp}interface ${constructPropInterfaceName} ${ext}{`)

        // START BODY
        {
            def.push(
                ...this.generateProperties(
                    girClass._tsData.constructProps.map((cp) => cp._tsData).filter((cp) => !!cp) as TsProperty[],
                    false,
                    namespace,
                    `Own constructor properties of ${girClass._module.packageName}.${girClass._fullSymName}`,
                    indentCount + 1,
                ),
            )

            // Implemented constructor properties
            // for (const versionFullSymName of Object.keys(girClass._tsData.implements)) {
            //     const constructProps = girClass._tsData.implements[versionFullSymName]?.constructProps
            //     def.push(
            //         ...this.generateProperties(
            //             constructProps,
            //             false,
            //             namespace,
            //             `Implemented constructor properties of ${versionFullSymName}`,
            //             indentCount + 1,
            //         ),
            //     )
            // }
        }
        // END BODY
        def.push(`${indent}}`)
        def.push('')

        return def
    }

    private generateClassFields(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        onlyStatic: boolean,
        namespace: string,
        indentCount = 1,
    ) {
        const def: string[] = []
        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateClassFields'))
        }

        def.push(
            ...this.generateProperties(
                girClass._tsData.fields.map((f) => f._tsData).filter((f) => !!f) as TsProperty[],
                onlyStatic,
                namespace,
                `Own fields of ${girClass._module.packageName}.${girClass._fullSymName}`,
                indentCount,
            ),
        )

        // for (const versionFullSymName of Object.keys(girClass._tsData.inherit)) {
        //     const girFields = girClass._tsData.inherit[versionFullSymName]?.fields
        //     def.push(
        //         ...this.generateProperties(
        //             girFields,
        //             onlyStatic,
        //             namespace,
        //             `Extended fields of ${versionFullSymName}`,
        //             indentCount,
        //         ),
        //     )
        // }

        return def
    }

    private generateClassProperties(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        onlyStatic: boolean,
        namespace: string,
        indentCount = 1,
    ) {
        const def: string[] = []

        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateClassProperties'))
        }

        def.push(
            ...this.generateProperties(
                girClass._tsData.properties.map((p) => p._tsData).filter((p) => !!p) as TsProperty[],
                onlyStatic,
                namespace,
                `Own properties of ${girClass._module.packageName}.${girClass._fullSymName}`,
                indentCount,
            ),
        )

        def.push(
            ...this.generateProperties(
                girClass._tsData.conflictProperties,
                onlyStatic,
                namespace,
                `Conflicting properties`,
                indentCount,
            ),
        )

        // Properties from inheritance
        // for (const versionFullSymName of Object.keys(girClass._tsData.inherit)) {
        //     def.push(
        //         ...this.generateProperties(
        //             girClass._tsData.inherit[versionFullSymName].properties,
        //             namespace,
        //             `Extended properties of ${versionFullSymName}`,
        //             indentCount,
        //         ),
        //     )
        // }

        // Properties from implementation
        // for (const versionFullSymName of Object.keys(girClass._tsData.implements)) {
        //     def.push(
        //         ...this.generateProperties(
        //             girClass._tsData.implements[versionFullSymName].properties,
        //             namespace,
        //             `Implemented properties of ${versionFullSymName}`,
        //             indentCount,
        //         ),
        //     )
        // }

        return def
    }

    private generateClassMethods(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        onlyStatic: boolean,
        namespace: string,
        indentCount = 1,
    ) {
        const def: string[] = []
        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateClassMethods'))
        }

        def.push(
            ...this.generateFunctions(
                girClass._tsData.methods.map((girFunc) => girFunc._tsData).filter((tsFunc) => !!tsFunc) as TsFunction[],
                onlyStatic,
                namespace,
                indentCount,
                `Owm ${onlyStatic ? 'static ' : ''}methods of ${girClass._module.packageName}.${girClass._fullSymName}`,
            ),
        )

        def.push(
            ...this.generateFunctions(
                girClass._tsData.conflictMethods,
                onlyStatic,
                namespace,
                indentCount,
                `Conflicting ${onlyStatic ? 'static ' : ''}methods`,
            ),
        )

        // Methods from inheritance
        // for (const versionFullSymName of Object.keys(girClass._tsData.inherit)) {
        //     def.push(
        //         ...this.generateFunctions(
        //             girClass._tsData.inherit[versionFullSymName].methods,
        //             onlyStatic,
        //             namespace,
        //             indentCount,
        //             `Extended methods of ${versionFullSymName}`,
        //         ),
        //     )
        // }

        // Methods from implementation
        // for (const versionFullSymName of Object.keys(girClass._tsData.implements)) {
        //     def.push(
        //         ...this.generateFunctions(
        //             girClass._tsData.implements[versionFullSymName].methods,
        //             onlyStatic,
        //             namespace,
        //             indentCount,
        //             `Implemented methods of ${versionFullSymName}`,
        //         ),
        //     )
        // }

        return def
    }

    private generateClassConstructors(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
        indentCount = 1,
    ) {
        const def: string[] = []
        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateClassConstructors'))
        }

        // Constructors
        def.push(
            ...this.generateFunctions(
                girClass._tsData.constructors
                    .map((girFunc) => girFunc._tsData)
                    .filter((tsFunc) => !!tsFunc) as TsFunction[],
                true,
                namespace,
                indentCount,
            ),
        )
        // _init method
        def.push(
            ...this.generateFunctions(
                girClass._tsData.constructors
                    .map((girFunc) => girFunc._tsData)
                    .filter((tsFunc) => !!tsFunc) as TsFunction[],
                false,
                namespace,
                indentCount,
            ),
        )
        // Pseudo constructors
        def.push(
            ...this.generateFunctions(
                girClass._tsData.staticFunctions
                    .map((girFunc) => girFunc._tsData)
                    .filter((tsFunc) => !!tsFunc) as TsFunction[],
                true,
                namespace,
                indentCount,
            ),
        )

        if (def.length) {
            def.unshift(
                ...this.addInfoComment(
                    `Constructors of ${girClass._module.packageName}.${girClass._fullSymName}`,
                    indentCount,
                ),
            )
        }

        // TODO also fix static and constructor conflicts and remove the code above

        // Methods from inheritance
        // for (const versionFullSymName of Object.keys(girClass._tsData.inherit)) {
        //     const inherit = girClass._tsData.inherit[versionFullSymName]
        //     const inheritDef: string[] = []

        //     // Static methods of abstract classes
        //     inheritDef.push(...this.generateOnlyStaticFunctions(inherit.class.methods, namespace, indentCount))
        //     // Constructors
        //     inheritDef.push(...this.generateOnlyStaticFunctions(inherit.class.constructors, namespace, indentCount))
        //     // Pseudo constructors
        //     inheritDef.push(...this.generateOnlyStaticFunctions(inherit.class.staticFunctions, namespace, indentCount))

        //     if (inheritDef.length) {
        //         inheritDef.unshift(
        //             ...this.addInfoComment(
        //                 `Extended static methods and constructors of ${versionFullSymName}`,
        //                 indentCount,
        //             ),
        //         )
        //     }

        //     def.push(...inheritDef)
        // }

        // Methods from implementation
        // for (const versionFullSymName of Object.keys(girClass._tsData.implements)) {
        //     const impl = girClass._tsData.implements[versionFullSymName]
        //     const implDef: string[] = []

        //     // Static methods of abstract classes
        //     implDef.push(...this.generateOnlyStaticFunctions(impl.interface.methods, namespace, indentCount))
        //     // Constructors
        //     implDef.push(...this.generateOnlyStaticFunctions(impl.interface.constructors, namespace, indentCount))
        //     // Pseudo constructors
        //     implDef.push(...this.generateOnlyStaticFunctions(impl.interface.staticFunctions, namespace, indentCount))

        //     if (implDef.length) {
        //         implDef.unshift(
        //             ...this.addInfoComment(
        //                 `Implemented static methods and constructors of ${versionFullSymName}`,
        //                 indentCount,
        //             ),
        //         )
        //     }

        //     def.push(...implDef)
        // }

        return def
    }

    /**
     * Instance methods, vfunc_ prefix
     * @param girClass
     */
    private generateClassVirtualMethods(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
        indentCount = 1,
    ) {
        const def: string[] = []
        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateClassVirtualMethods'))
        }

        // Virtual methods currently not supported in node-gtk
        if (this.config.environment === 'node') {
            return def
        }

        def.push(
            ...this.generateFunctions(
                girClass._tsData.virtualMethods
                    .map((girFunc) => girFunc._tsData)
                    .filter((tsFunc) => !!tsFunc) as TsFunction[],
                false,
                namespace,
                indentCount,
                `Own virtual methods of ${girClass._module.packageName}.${girClass._fullSymName}`,
            ),
        )

        // Virtual methods from inheritance
        // for (const versionFullSymName of Object.keys(girClass._tsData.inherit)) {
        //     def.push(
        //         ...this.generateFunctions(
        //             girClass._tsData.inherit[versionFullSymName].virtualMethods,
        //             namespace,
        //             indentCount,
        //             `Extended virtual methods of ${versionFullSymName}`,
        //         ),
        //     )
        // }

        return def
    }

    private generateClassSignalInterfaces(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
    ) {
        const def: string[] = []
        if (!girClass._tsData) {
            throw new Error(NO_TSDATA('generateClassSignalInterface'))
        }

        for (const signal of girClass._tsData.signals) {
            if (!signal._tsData) continue
            def.push(...this.generateCallbackInterface(signal._tsData, namespace))
            def.push('')
        }

        return def
    }

    private generateClassSignals(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
    ) {
        const def: string[] = []
        if (!girClass._tsData || !girClass._fullSymName || !girClass._module) {
            throw new Error(NO_TSDATA('generateClassSignals'))
        }

        const signalDescs = this.generateSignals(girClass._tsData.signals, girClass, namespace, 0)

        def.push(
            ...this.mergeDescs(
                signalDescs,
                `Own signals of ${girClass._module.packageName}.${girClass._fullSymName}`,
                1,
            ),
        )

        // // Signals from inheritance
        // for (const versionFullSymName of Object.keys(girClass._tsData.inherit)) {
        //     const signalDescs = this.generateSignals(
        //         girClass._tsData.inherit[versionFullSymName].signals,
        //         girClass,
        //         namespace,
        //         0,
        //     )
        //     def.push(...this.mergeDescs(signalDescs, `Extended signals of ${versionFullSymName}`, 1))
        // }

        // // Signals from implementation
        // for (const versionFullSymName of Object.keys(girClass._tsData.implements)) {
        //     const signalDescs = this.generateSignals(
        //         girClass._tsData.implements[versionFullSymName].signals,
        //         girClass,
        //         namespace,
        //         0,
        //     )
        //     def.push(...this.mergeDescs(signalDescs, `Implemented signals of ${versionFullSymName}`, 1))
        // }

        return def
    }

    /**
     * In Typescript, interfaces and classes can have the same name,
     * so we use this to generate interfaces with the same name to implement multiple inheritance
     * @param girClass
     * @param namespace
     */
    private generateImplementationInterface(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
    ) {
        const def: string[] = []

        if (!girClass._tsData) return def

        const genericParameters = this.generateGenericParameters(girClass._tsData.generics)
        const implementationNames = girClass._tsData.parents
            .filter((implementation) => implementation.type !== 'parent')
            .map((implementation) => implementation.localParentName)
        const ext = implementationNames.length ? ` extends ${implementationNames.join(', ')}` : ''
        const classHead = `${girClass._tsData.name}${genericParameters}${ext}`

        def.push(...this.generateClassSignalInterfaces(girClass, namespace))

        // START INTERFACE
        {
            def.push(this.generateExport('interface', classHead, '{'))

            // START BODY
            {
                // Properties
                def.push(...this.generateClassProperties(girClass, false, namespace))

                // Fields
                def.push(...this.generateClassFields(girClass, false, namespace))

                // Methods
                def.push(...this.generateClassMethods(girClass, false, namespace))

                // Virtual methods
                def.push(...this.generateClassVirtualMethods(girClass, namespace))

                // Signals
                def.push(...this.generateClassSignals(girClass, namespace))

                // TODO: Generate GirSignalElements instead of generate the signal definition strings directly
                def.push(...this.generateClassPropertySignals(girClass, namespace))
            }
            // END BODY

            // END INTERFACE
            def.push('}')
            def.push('')
        }

        return def
    }

    /**
     * Represents a record, GObject class or interface as a Typescript class
     * @param girClass
     * @param namespace
     */
    private generateClass(
        girClass: GirClassElement | GirUnionElement | GirInterfaceElement | GirRecordElement,
        namespace: string,
    ) {
        const def: string[] = []

        if (!girClass._tsData) return def

        // Properties for construction
        def.push(...this.generateConstructPropsInterface(girClass, namespace))

        def.push(...this.generateImplementationInterface(girClass, namespace))

        def.push(...this.addGirDocComment(girClass._tsData.doc, 0))

        const genericParameters = this.generateGenericParameters(girClass._tsData.generics)
        const parentName = girClass._tsData.parents.find((parent) => parent.type === 'parent')?.localParentName
        const ext = parentName ? ` extends ${parentName}` : ''
        const classHead = `${girClass._tsData.name}${genericParameters}${ext}`

        // START CLASS
        {
            if (girClass._tsData.isAbstract) {
                def.push(this.generateExport('abstract class', classHead, '{'))
            } else {
                def.push(this.generateExport('class', classHead, '{'))
            }

            // START BODY
            {
                // // Properties
                def.push(...this.generateClassProperties(girClass, true, namespace))

                // // Fields
                def.push(...this.generateClassFields(girClass, true, namespace))

                // Constructors
                def.push(...this.generateClassConstructors(girClass, namespace))

                // Static Methods
                def.push(...this.generateClassMethods(girClass, true, namespace))

                // Virtual methods
                // def.push(...this.generateClassVirtualMethods(girClass, namespace))

                // Signals
                // def.push(...this.generateClassSignals(girClass, namespace))

                // TODO: Generate GirSignalElements instead of generate the signal definition strings directly
                // def.push(...this.generateClassPropertySignals(girClass, namespace))

                // // TODO: Records have fields
            }
            // END BODY

            // END CLASS
            def.push('}')
            def.push('')
        }

        return def
    }

    private async exportModuleJS(moduleTemplateProcessor: TemplateProcessor, girModule: GirModule): Promise<void> {
        const template = 'module.js'
        if (this.config.outdir) {
            await moduleTemplateProcessor.create(template, this.config.outdir, `${girModule.packageName}.js`)
        } else {
            const moduleContent = moduleTemplateProcessor.load(template)
            this.log.log(moduleContent)
        }
    }

    private async exportModuleTS(moduleTemplateProcessor: TemplateProcessor, girModule: GirModule): Promise<void> {
        const template = 'module.d.ts'
        const out: string[] = []

        out.push(...this.addTSDocCommentLines([girModule.packageName]))

        out.push('')

        const deps: string[] = girModule.transitiveDependencies

        // Module dependencies as type references or imports
        if (this.config.environment === 'gjs') {
            out.push(...this.generateModuleDependenciesImport('Gjs', 'Gjs', false))
        }

        for (const depPackageName of deps) {
            // Don't reference yourself as a dependency
            if (girModule.packageName !== depPackageName) {
                const girFilename = `${depPackageName}.gir`
                const { namespace } = splitModuleName(depPackageName)
                const depFile = findFileInDirs(this.config.girDirectories, girFilename)
                if (depFile.exists) {
                    out.push(...this.generateModuleDependenciesImport(namespace, depPackageName, false))
                } else {
                    out.push(`// WARN: Dependency not found: '${depPackageName}'`)
                    this.log.warn(WARN_NOT_FOUND_DEPENDENCY_GIR_FILE(girFilename))
                }
            }
        }

        // START Namespace
        {
            if (this.config.buildType === 'types') {
                out.push('')
                out.push(`declare namespace ${girModule.namespace} {`)
            } else if (this.config.useNamespace) {
                out.push('')
                out.push(`export namespace ${girModule.namespace} {`)
            }

            // Newline
            out.push('')

            if (girModule.ns.enumeration)
                for (const girEnum of girModule.ns.enumeration) out.push(...this.generateEnumeration(girEnum))

            if (girModule.ns.bitfield)
                for (const girBitfield of girModule.ns.bitfield) out.push(...this.generateEnumeration(girBitfield))

            if (girModule.ns.constant)
                for (const girConst of girModule.ns.constant) {
                    if (!girConst._tsData) continue
                    out.push(...this.generateConstant(girConst._tsData, girModule.namespace, 0))
                }

            if (girModule.ns.function)
                for (const girFunc of girModule.ns.function) {
                    if (!girFunc._tsData) {
                        // this.log.warn(NO_TSDATA('exportModuleTS functions'))
                        continue
                    }
                    out.push(...this.generateFunction(girFunc._tsData, false, girModule.namespace, 0))
                }

            if (girModule.ns.callback)
                for (const girCallback of girModule.ns.callback) {
                    if (!girCallback._tsData) continue
                    out.push(...this.generateCallbackInterface(girCallback._tsData, girModule.namespace))
                }

            if (girModule.ns.interface)
                for (const girIface of girModule.ns.interface)
                    if (girIface._module) {
                        out.push(...this.generateClass(girIface, girIface._module.namespace))
                    }

            // Extra interfaces if a template with the module name  (e.g. '../templates/GObject-2.0.d.ts') is found
            // E.g. used for GObject-2.0 to help define GObject classes in js;
            // these aren't part of gi.
            if (moduleTemplateProcessor.exists(`${girModule.packageName}.d.ts`)) {
                const templatePatches = await moduleTemplateProcessor.load(`${girModule.packageName}.d.ts`)
                out.push(templatePatches)
            }

            if (girModule.ns.class)
                for (const gitClass of girModule.ns.class)
                    if (gitClass._module) {
                        out.push(...this.generateClass(gitClass, gitClass._module.namespace))
                    }

            if (girModule.ns.record)
                for (const girRecord of girModule.ns.record)
                    if (girRecord._module) {
                        out.push(...this.generateClass(girRecord, girRecord._module.namespace))
                    }

            if (girModule.ns.union)
                for (const girUnion of girModule.ns.union)
                    if (girUnion._module) {
                        out.push(...this.generateClass(girUnion, girUnion._module.namespace))
                    }

            if (girModule.ns.alias)
                // GType is not a number in GJS
                for (const girAlias of girModule.ns.alias)
                    if (girModule.packageName !== 'GObject-2.0' || girAlias.$.name !== 'Type')
                        out.push(...this.generateAlias(girAlias, girModule.namespace, 1))
        }
        // END Namespace
        if (this.config.useNamespace) {
            out.push(`}`)
        }

        if (this.config.buildType !== 'types' && this.config.useNamespace) {
            out.push(`export default ${girModule.namespace};`)
        }

        const outResult = out.join('\n') // End of file

        if (this.config.outdir) {
            await moduleTemplateProcessor.create(
                template,
                this.config.outdir,
                `${girModule.packageName}.d.ts`,
                outResult,
            )
        } else {
            const moduleContent = await moduleTemplateProcessor.load(template)
            this.log.log(moduleContent + '\n' + outResult)
        }
    }

    private async exportModule(girModule: GirModule) {
        const moduleTemplateProcessor = new TemplateProcessor(
            {
                name: girModule.namespace,
                namespace: girModule.namespace,
                version: girModule.version,
                importName: girModule.importName,
            },
            girModule.packageName,
            this.config,
        )

        await this.exportModuleTS(moduleTemplateProcessor, girModule)

        if (this.config.buildType === 'lib') {
            await this.exportModuleJS(moduleTemplateProcessor, girModule)
        }
    }

    private async exportGjs(girModules: GirModule[], girModulesGrouped: GirModulesGrouped[]) {
        if (!this.config.outdir) return

        const templateProcessor = new TemplateProcessor(
            { girModules: girModules, girModulesGrouped },
            'gjs',
            this.config,
        )

        // Types
        await templateProcessor.create('Gjs.d.ts', this.config.outdir, 'Gjs.d.ts')
        await templateProcessor.create('index.d.ts', this.config.outdir, 'index.d.ts')

        // Lib
        if (this.config.buildType === 'lib') {
            await templateProcessor.create('index.js', this.config.outdir, 'index.js')
            const template = 'Gjs.js'
            await templateProcessor.create(template, this.config.outdir, 'Gjs.js')
        }
    }

    private async exportGjsCastLib(inheritanceTable: InheritanceTable) {
        if (!this.config.outdir) return

        const inheritanceTableKeys = Object.keys(inheritanceTable)
        const templateProcessor = new TemplateProcessor({ inheritanceTableKeys, inheritanceTable }, 'gjs', this.config)
        await templateProcessor.create('cast.ts', this.config.outdir, 'cast.ts')
    }

    private async exportNodeGtk(girModules: GirModule[], girModulesGrouped: GirModulesGrouped[]) {
        if (!this.config.outdir) return

        const templateProcessor = new TemplateProcessor({ girModules, girModulesGrouped }, 'node', this.config)

        await templateProcessor.create('index.d.ts', this.config.outdir, 'index.d.ts')
        if (this.config.buildType === 'lib') {
            await templateProcessor.create('index.js', this.config.outdir, 'index.js')
        }
    }

    public async start(
        girModules: GirModule[],
        girModulesGrouped?: GirModulesGrouped[],
        inheritanceTable?: InheritanceTable,
    ) {
        for (const girModule of girModules) {
            await this.exportModule(girModule)
        }

        if (this.config.environment === 'node' && girModulesGrouped) {
            // node-gtk internal stuff
            await this.exportNodeGtk(girModules, girModulesGrouped)
        }

        if (this.config.environment === 'gjs' && girModulesGrouped && inheritanceTable) {
            // GJS internal stuff
            await this.exportGjs(girModules, girModulesGrouped)
            await this.exportGjsCastLib(inheritanceTable)
        }
    }
}
