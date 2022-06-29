import {
    GirCallableParamElement,
    GirInstanceParameter,
    TsGenericParameter,
    TsType,
    TsDoc,
    TypeTsFunction,
    TypeGirFunction,
} from './index.js'

/**
 * Holds the data to generate a function in/for Typescript
 */
export interface TsFunction {
    name: string
    /**
     * Actually there are no multiple return types in gir.
     * We still use an array to resolve conflicts with multiple inheritance
     */
    returnTypes: TsType[]
    /** `true` if this function is a arrow function: `() => {}` */
    isArrowType: boolean
    /** c `static foobar() {}` */
    isStatic: boolean
    /** true if this function is a global function and not part of a class: `function foobar() {}` */
    isGlobal: boolean
    /** true if this function is a virtual method with the `vfunc:` prefix: vfunc_foobar() {} */
    isVirtual: boolean
    overrideReturnType?: string
    retTypeIsVoid: boolean
    inParams: GirCallableParamElement[]
    instanceParameters: GirInstanceParameter[]
    outParams: GirCallableParamElement[]
    generics: TsGenericParameter[]

    /** Function overloads, used in `ConflictResolver` */
    overloads: TsFunction[]

    /** Temporary property, we will try later to resolve the conflicts correctly */
    hasUnresolvedConflict?: boolean

    // CUSTOM
    girTypeName: TypeGirFunction
    /**
     * - Functions are usually exported as global functions in typescript, but can also be static functions of a class
     * - Signals are represented in Typescript as multiple event methods
     * - Virtual methods are represented in Typescript as normal methods with the prefix "vfunc_"
     * - Callbacks are generated as interfaces
     */
    tsTypeName: TypeTsFunction

    /** Typescript data to generate documentations in TSDoc style */
    doc: TsDoc
}
