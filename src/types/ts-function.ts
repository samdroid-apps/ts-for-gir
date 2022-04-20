import {
    GirCallableParamElement,
    GirInstanceParameter,
    GirConstructorElement,
    GirFunctionElement,
    GirVirtualMethodElement,
    GirMethodElement,
    TsGenericParameter,
    TsType,
} from '.'

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
    overloads: Array<GirConstructorElement | GirFunctionElement | GirVirtualMethodElement | GirMethodElement>

    /** Temporary property, we will try later to resolve the conflicts correctly */
    hasConflict?: boolean
}
