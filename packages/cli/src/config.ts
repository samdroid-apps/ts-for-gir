/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Default values, parse the config file and handle CLI flags
 */
import inquirer from 'inquirer'
import { Options } from 'yargs'
import { cosmiconfig, Options as ConfigSearchOptions } from 'cosmiconfig'
import { join, extname, dirname, resolve } from 'path'
import { writeFile } from 'fs/promises'
import OS from 'os'
import {
    merge,
    isEqual,
    Logger,
    APP_NAME,
    APP_USAGE,
    WARN_NO_NAMESPACE_ON_TYPES,
    WARN_NO_NAMESPACE_ON_ESM,
    ERROR_CONFIG_EXTENSION_UNSUPPORTED,
    WARN_USE_ESM_FOR_ALIAS,
    WARN_USE_GJS_FOR_ALIAS,
} from '@ts-for-gir/lib'
import { readTsJsConfig } from './utils.js'

import type { Environment, UserConfig, ConfigFlags, UserConfigLoadResult, GenerateConfig } from '@ts-for-gir/lib'

export class Config {
    static appName = APP_NAME

    static usage = APP_USAGE

    /**
     * Default cli flag and argument values
     */
    static defaults = {
        environments: ['gjs'],
        print: false,
        configName: '.ts-for-girrc.js',
        outdir: './@types',
        girDirectories: OS.platform() === 'darwin' ? ['/usr/local/share/gir-1.0'] : ['/usr/share/gir-1.0'],
        modules: ['*'],
        ignore: [],
        verbose: false,
        ignoreVersionConflicts: false,
        noNamespace: false,
        buildType: 'lib',
        moduleType: 'esm',
        noComments: false,
        noDebugComments: false,
        fixConflicts: true,
        noDOMLib: false,
        gnomeShellTypes: false,
        generateAlias: false,
        promisify: false,
    }

    static configFilePath = join(process.cwd(), Config.defaults.configName)

    /**
     * CLI options used in commands/generate.ts and commands/list.ts
     */
    static options: { [name: string]: Options } = {
        modules: {
            description: "GIR modules to load, e.g. 'Gio-2.0'. Accepts multiple modules",
            array: true,
            default: Config.defaults.modules,
            normalize: true,
        },
        girDirectories: {
            type: 'string',
            alias: 'g',
            description: 'GIR directories',
            array: true,
            default: Config.defaults.girDirectories,
            normalize: true,
        },
        outdir: {
            type: 'string',
            alias: 'o',
            description: 'Directory to output to',
            default: Config.defaults.outdir,
            normalize: true,
        },
        environments: {
            type: 'string',
            alias: 'e',
            description: 'Javascript environment',
            array: true,
            choices: ['gjs', 'node'],
            default: Config.defaults.environments,
            normalize: true,
        },
        ignore: {
            type: 'string',
            alias: 'i',
            description: 'Modules that should be ignored',
            array: true,
            default: Config.defaults.ignore,
            normalize: true,
        },
        buildType: {
            type: 'string',
            alias: 'b',
            description: 'Definitions generation type',
            array: false,
            choices: ['lib', 'types'],
            default: Config.defaults.buildType,
            normalize: true,
        },
        moduleType: {
            type: 'string',
            alias: 't',
            description: 'Specify what module code is generated.',
            choices: ['esm', 'commonjs'],
            default: Config.defaults.moduleType,
            normalize: true,
        },
        verbose: {
            type: 'boolean',
            alias: 'v',
            description: 'Switch on/off the verbose mode',
            default: Config.defaults.verbose,
            normalize: true,
        },
        ignoreVersionConflicts: {
            type: 'boolean',
            description: 'Do not ask for package versions if multiple versions are found',
            default: Config.defaults.ignoreVersionConflicts,
            normalize: true,
        },
        print: {
            type: 'boolean',
            alias: 'p',
            description: 'Print the output to console and create no files',
            default: Config.defaults.print,
            normalize: true,
        },
        configName: {
            type: 'string',
            description: 'Name of the config if you want to use a different name',
            default: Config.defaults.configName,
            normalize: true,
        },
        noNamespace: {
            type: 'boolean',
            alias: 'd',
            description: 'Do not export all symbols for each module as a namespace',
            default: Config.defaults.noNamespace,
            normalize: true,
        },
        noComments: {
            type: 'boolean',
            alias: 'n',
            description: 'Do not generate documentation comments',
            default: Config.defaults.noComments,
            normalize: true,
        },
        noDebugComments: {
            type: 'boolean',
            description: 'Do not generate debugging inline comments',
            default: Config.defaults.noDebugComments,
            normalize: true,
        },
        fixConflicts: {
            type: 'boolean',
            description: 'Fix Inheritance and implementation type conflicts',
            default: Config.defaults.fixConflicts,
            normalize: true,
        },
        noDOMLib: {
            type: 'boolean',
            description: 'Disables the generation of types that are in conflict with the DOM types',
            default: Config.defaults.noDOMLib,
            normalize: true,
        },
        gnomeShellTypes: {
            type: 'boolean',
            description: 'Generate types for GNOME Shell (Experimental)',
            default: Config.defaults.gnomeShellTypes,
            normalize: true,
        },
        generateAlias: {
            type: 'boolean',
            alias: 'a',
            description: 'Generate an alias tsconfig file to support GJS ESM module imports',
            default: Config.defaults.generateAlias,
            normalize: true,
        },
        promisify: {
            type: 'boolean',
            description: 'Generate promisified functions for async/finish calls',
            default: Config.defaults.promisify,
            normalize: true,
        },
    }

    /**
     * CLI flags used in commands/generate.ts
     */
    static generateOptions = {
        modules: this.options.modules,
        girDirectories: this.options.girDirectories,
        outdir: this.options.outdir,
        environments: this.options.environments,
        ignore: this.options.ignore,
        buildType: this.options.buildType,
        moduleType: this.options.moduleType,
        verbose: this.options.verbose,
        ignoreVersionConflicts: this.options.ignoreVersionConflicts,
        print: this.options.print,
        configName: this.options.configName,
        noNamespace: this.options.noNamespace,
        noComments: this.options.noComments,
        noDebugComments: this.options.noDebugComments,
        noDOMLib: this.options.noDOMLib,
        fixConflicts: this.options.fixConflicts,
        gnomeShellTypes: this.options.gnomeShellTypes,
        generateAlias: this.options.generateAlias,
        promisify: this.options.promisify,
    }

    static listOptions = {
        modules: this.options.modules,
        girDirectories: Config.options.girDirectories,
        ignore: Config.options.ignore,
        configName: Config.options.configName,
        verbose: Config.options.verbose,
    }

    /**
     * Overwrites values in the user config
     * @param configsToAdd
     */
    public static async addToConfig(configsToAdd: Partial<UserConfig>): Promise<void> {
        const userConfig = await this.loadConfigFile()
        const path = userConfig?.filepath || this.configFilePath
        const configToStore = {}
        merge(configToStore, userConfig?.config || {}, configsToAdd)
        const fileExtension = extname(path)
        let writeConfigString = ''
        switch (fileExtension) {
            case '.js':
                writeConfigString = `export default ${JSON.stringify(configToStore, null, 4)}`
                break
            case '.json':
                writeConfigString = `${JSON.stringify(configToStore, null, 4)}`
                break
            default:
                Logger.error(ERROR_CONFIG_EXTENSION_UNSUPPORTED)
                break
        }
        if (writeConfigString && path) {
            return writeFile(path, writeConfigString)
        }
    }

    /**
     * The user can create a `.ts-for-girrc` file for his default configs,
     * this method load this config file an returns the user configuration
     * @param configName If the user uses a custom config file name
     */
    private static async loadConfigFile(configName?: string): Promise<UserConfigLoadResult | null> {
        const configSearchOptions: ConfigSearchOptions = {
            loaders: {
                // ESM loader
                '.js': async (filepath) => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const file = await import(filepath)

                    // Files with `exports.default = { ... }`
                    if (file?.default?.default) {
                        return file.default.default as Partial<UserConfig>
                    }
                    // Files with `export default { ... }`
                    if (file?.default) {
                        return file.default as Partial<UserConfig>
                    }
                    // Files with `export { ... }`
                    return file as Partial<UserConfig>
                },
            },
        }
        if (configName) {
            configSearchOptions.searchPlaces = [configName]
        }
        const configFile: UserConfigLoadResult | null = await cosmiconfig(Config.appName, configSearchOptions).search()
        if (configFile?.filepath) {
            Config.configFilePath = configFile.filepath
            const configDir = dirname(configFile.filepath)

            // If outdir is not absolute, make it relative to the config file
            if (configFile.config.outdir && !configFile.config.outdir?.startsWith('/')) {
                configFile.config.outdir = resolve(configDir, configFile.config.outdir)
            }

            // Same for girDirectories
            if (configFile.config.girDirectories) {
                configFile.config.girDirectories = configFile.config.girDirectories.map((dir) => {
                    if (!dir.startsWith('/')) {
                        return resolve(configDir, dir)
                    }
                    return dir
                })
            }
        }

        return configFile
    }

    public static getGenerateConfig(config: UserConfig, environment: Environment = 'gjs'): GenerateConfig {
        const generateConfig: GenerateConfig = {
            environment: environment,
            girDirectories: config.girDirectories,
            outdir: config.outdir,
            verbose: config.verbose,
            buildType: config.buildType,
            moduleType: config.moduleType,
            noNamespace: config.noNamespace,
            noComments: config.noComments,
            noDebugComments: config.noDebugComments,
            fixConflicts: config.fixConflicts,
            noDOMLib: config.noDOMLib,
            gnomeShellTypes: config.gnomeShellTypes,
            generateAlias: config.generateAlias,
            promisify: config.promisify,
        }
        return generateConfig
    }

    protected static async validateTsConfig(config: UserConfig): Promise<UserConfig> {
        const tsCompilerOptions = (config.outdir && readTsJsConfig(config.outdir)?.compilerOptions) || {}
        const tsConfigHasDOMLib = tsCompilerOptions.noLib
            ? false // NoLib makes typescript to ignore the lib property
            : Array.isArray(tsCompilerOptions.lib)
            ? tsCompilerOptions.lib.some((lib) => lib.toLowerCase().startsWith('dom'))
            : true // Typescript icludes DOM lib by default

        if (config.environments.includes('gjs') && tsConfigHasDOMLib && !config.noDOMLib) {
            const answer = (
                await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'include',
                        choices: ['Yes', 'No'],
                        message:
                            'Your typescript compilerOptions includes the DOM lib, this conflicts with some Gjs global types, do you want to skip generating those types?',
                    },
                ])
            ).include as 'Yes' | 'No'

            if (answer == 'No') config.noDOMLib = true
        }

        return config
    }

    public static async validate(config: UserConfig): Promise<UserConfig> {
        if (config.buildType === 'types') {
            if (config.noNamespace !== false) {
                Logger.warn(WARN_NO_NAMESPACE_ON_TYPES)
                config.noNamespace = false
            }
        }

        if (config.moduleType === 'esm') {
            if (config.noNamespace !== false) {
                Logger.warn(WARN_NO_NAMESPACE_ON_ESM)
                config.noNamespace = false
            }
        }

        if (config.generateAlias) {
            if (!config.environments.includes('gjs')) {
                Logger.warn(WARN_USE_GJS_FOR_ALIAS)
                config.environments.push('gjs')
            }
            if (config.moduleType !== 'esm') {
                Logger.warn(WARN_USE_ESM_FOR_ALIAS)
                config.moduleType = 'esm'
            }
        }

        if (config.moduleType === 'esm') {
            if (config.noNamespace !== false) {
                Logger.warn(WARN_NO_NAMESPACE_ON_ESM)
                config.noNamespace = false
            }
        }

        config = await this.validateTsConfig(config)

        return config
    }

    /**
     * Loads the values of the config file and concatenate them with passed cli flags / arguments.
     * The values from config file are preferred if the cli flag value is the default (and so not set / overwritten)
     * @param options
     */
    public static async load(options: ConfigFlags): Promise<UserConfig> {
        const configFile = await this.loadConfigFile(options.configName)
        const configFileData = configFile?.config || {}

        const config: UserConfig = {
            environments: options.environments,
            buildType: options.buildType,
            moduleType: options.moduleType,
            verbose: options.verbose,
            ignoreVersionConflicts: options.ignoreVersionConflicts,
            print: options.print,
            outdir: options.outdir,
            girDirectories: options.girDirectories,
            ignore: options.ignore,
            modules: options.modules,
            noNamespace: options.noNamespace,
            noComments: options.noComments,
            noDebugComments: options.noDebugComments,
            fixConflicts: options.fixConflicts,
            noDOMLib: options.noDOMLib,
            gnomeShellTypes: options.gnomeShellTypes,
            generateAlias: options.generateAlias,
            promisify: options.promisify,
        }

        if (configFileData) {
            // environments
            if (isEqual(config.environments, Config.defaults.environments) && configFileData.environments) {
                config.environments = configFileData.environments
            }
            // buildType
            if (config.buildType === Config.options.buildType.default && configFileData.buildType) {
                config.buildType = configFileData.buildType
            }
            // moduleType
            if (config.moduleType === Config.options.moduleType.default && configFileData.moduleType) {
                config.moduleType = configFileData.moduleType
            }
            // verbose
            if (config.verbose === Config.options.verbose.default && typeof configFileData.verbose === 'boolean') {
                config.verbose = configFileData.verbose
            }
            // ignoreVersionConflicts
            if (
                config.ignoreVersionConflicts === Config.options.ignoreVersionConflicts.default &&
                typeof configFileData.ignoreVersionConflicts === 'boolean'
            ) {
                config.ignoreVersionConflicts = configFileData.ignoreVersionConflicts
            }
            // print
            if (config.print === Config.options.print.default && typeof configFileData.print === 'boolean') {
                config.print = configFileData.print
            }
            // outdir
            if (config.outdir === Config.options.outdir.default && configFileData.outdir) {
                config.outdir = config.print ? null : configFileData.outdir
            }
            // girDirectories
            if (config.girDirectories === Config.options.girDirectories.default && configFileData.girDirectories) {
                config.girDirectories = configFileData.girDirectories
            }
            // ignore
            if (
                (!config.ignore || config.ignore.length <= 0 || isEqual(config.ignore, Config.defaults.ignore)) &&
                configFileData.ignore
            ) {
                config.ignore = configFileData.ignore
            }
            // modules
            if (
                (config.modules.length <= 0 || isEqual(config.modules, Config.defaults.modules)) &&
                configFileData.modules
            ) {
                config.modules = configFileData.modules
            }
            // noNamespace
            if (
                config.noNamespace === Config.options.noNamespace.default &&
                typeof configFileData.noNamespace === 'boolean'
            ) {
                config.noNamespace = configFileData.noNamespace
            }
            // noComments
            if (
                config.noComments === Config.options.noComments.default &&
                typeof configFileData.noComments === 'boolean'
            ) {
                config.noComments = configFileData.noComments
            }
            // noDebugComments
            if (
                config.noDebugComments === Config.options.noDebugComments.default &&
                typeof configFileData.noDebugComments === 'boolean'
            ) {
                config.noDebugComments = configFileData.noDebugComments
            }
            // fixConflicts
            if (
                config.fixConflicts === Config.options.fixConflicts.default &&
                typeof configFileData.fixConflicts === 'boolean'
            ) {
                config.fixConflicts = configFileData.fixConflicts
            }
            // noDOMLib
            if (config.noDOMLib === Config.options.noDOMLib.default && typeof configFileData.noDOMLib === 'boolean') {
                config.noDOMLib = configFileData.noDOMLib
            }
            // gnomeShellTypes
            if (
                config.gnomeShellTypes === Config.options.gnomeShellTypes.default &&
                typeof configFileData.gnomeShellTypes === 'boolean'
            ) {
                config.gnomeShellTypes = configFileData.gnomeShellTypes
            }
            // generateAlias
            if (
                config.generateAlias === Config.options.generateAlias.default &&
                typeof configFileData.generateAlias === 'boolean'
            ) {
                config.generateAlias = configFileData.generateAlias
            }
            // promisify
            if (
                config.promisify === Config.options.promisify.default &&
                typeof configFileData.promisify === 'boolean'
            ) {
                config.promisify = configFileData.promisify
            }
        }

        return await this.validate(config)
    }
}
