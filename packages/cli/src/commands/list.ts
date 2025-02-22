/**
 * Everything you need for the `ts-for-gir list` command is located here
 */

import { Argv } from 'yargs'

import { ModuleLoader } from '../module-loader.js'
import { Config } from '../config.js'
import { Logger, ERROR_NO_MODULES_FOUND, ResolveType } from '@ts-for-gir/lib'

import type { ConfigFlags } from '@ts-for-gir/lib'

const command = 'list [modules..]'

const description = 'Lists all available GIR modules'

const builder = (yargs: Argv) => {
    return yargs
        .option('modules', Config.listOptions.modules)
        .option('girDirectories', Config.listOptions.girDirectories)
        .option('ignore', Config.listOptions.ignore)
        .option('verbose', Config.listOptions.verbose)
        .option('configName', Config.listOptions.configName)
        .example(examples)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = async (args: any /* TODO */) => {
    const config = await Config.load(args as ConfigFlags)
    const generateConfig = Config.getGenerateConfig(config)
    const moduleLoader = new ModuleLoader(generateConfig)
    const { grouped, failed } = await moduleLoader.getModules(config.modules, config.ignore)
    const moduleGroups = Object.values(grouped)
    if (Object.keys(grouped).length === 0) {
        return Logger.error(ERROR_NO_MODULES_FOUND(config.girDirectories))
    }

    const conflictModules = moduleGroups.filter((moduleGroup) => moduleGroup.hasConflict)

    const byHandModules = moduleGroups.filter(
        (moduleGroup) => moduleGroup.modules[0].resolvedBy === ResolveType.BY_HAND,
    )

    const depModules = moduleGroups.filter(
        (moduleGroup) => moduleGroup.modules[0].resolvedBy === ResolveType.DEPENDENCE,
    )

    Logger.info('\nSelected Modules:')
    for (const moduleGroup of byHandModules) {
        for (const depModule of moduleGroup.modules) {
            Logger.white(`- ${depModule.packageName}`)
        }
    }

    if (depModules.length > 0) {
        Logger.yellow('\nDependencies:')
        for (const moduleGroup of depModules) {
            for (const depModule of moduleGroup.modules) {
                Logger.white(`- ${depModule.packageName}`)
            }
        }
    }

    if (conflictModules.length > 0) {
        Logger.danger('\nConflicts:')
        for (const moduleGroup of conflictModules) {
            Logger.white(`- ${moduleGroup.namespace}`)
            for (const conflictModule of moduleGroup.modules) {
                Logger.white(`  - ${conflictModule.packageName}`)
            }
        }
    }

    if (failed.length > 0) {
        Logger.danger('\nDependencies not found:')
        for (const fail of failed) {
            Logger.white(`- ${fail}`)
        }
    }
}

const examples: ReadonlyArray<[string, string?]> = [
    [`${Config.appName} list -g ./vala-girs/gir-1.0`, `Lists all available GIR modules in ./vala-girs/gir-1.0`],
    [
        `${Config.appName} list --ignore=Gtk-3.0 xrandr-1.3`,
        'Lists all available GIR modules in /usr/share/gir-1.0 but not Gtk-3.0 and xrandr-1.3',
    ],
]

export const list = {
    command,
    description,
    builder,
    handler,
    examples,
}
