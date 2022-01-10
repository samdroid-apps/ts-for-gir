import fs from 'fs'
import Path from 'path'

import { GirModule } from './gir-module.js'
import TemplateProcessor from './template-processor.js'
import { Transformation } from './transformation.js'
import { Logger } from './logger.js'

import { InheritanceTable, GenerateConfig, GirModulesGrouped } from './types'

export class Generator {
    log: Logger
    constructor(private readonly config: GenerateConfig) {
        this.log = new Logger(config.environment, config.verbose, 'TsForGir')
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

    private finalizeInheritance(inheritanceTable: InheritanceTable): void {
        for (const clsName of Object.keys(inheritanceTable)) {
            let p: string | string[] = inheritanceTable[clsName][0]
            while (p) {
                p = inheritanceTable[p]
                if (p) {
                    p = p[0]
                    inheritanceTable[clsName].push(p)
                }
            }
        }
    }

    public async start(girModules: GirModule[], groupedGirModules: GirModulesGrouped[]): Promise<void> {
        this.log.info(
            `Start to generate .d.ts files for '${this.config.environment}' as '${
                this.config.buildType || 'unknown'
            }'.`,
        )

        if (girModules.length == 0) {
            this.log.error('Need to specify modules!')
        }

        GirModule.allGirModules = girModules

        //this.log.dir(girModules["GObject-2.0"], { depth: null })

        this.log.info('Files parsed, loading types...')

        for (const girModule of girModules) girModule.loadTypes()

        const inheritanceTable: InheritanceTable = {}
        for (const girModule of girModules) girModule.loadInheritance(inheritanceTable)

        this.finalizeInheritance(inheritanceTable)

        this.log.info('Types loaded, generating .d.ts...')

        for (const girModule of girModules) {
            let dtOut: NodeJS.WritableStream = process.stdout
            let dtOutputPath: string | null = null
            if (this.config.outdir) {
                const packageName: string = girModule.packageName || 'unknown'
                const outputDir = Transformation.getEnvironmentDir(this.config.environment, this.config.outdir)
                const dtFileName = `${packageName}.d.ts`
                dtOutputPath = Path.join(outputDir, dtFileName)
                fs.mkdirSync(outputDir, { recursive: true })
                dtOut = fs.createWriteStream(dtOutputPath)
            }
            this.log.log(` - ${girModule.packageName} ...`)
            await girModule.export(dtOut, dtOutputPath)
            if (this.config.buildType === 'lib') {
                await girModule.exportJs()
            }
        }

        if (this.config.environment === 'node') {
            // node-gtk internal stuff
            await this.exportNodeGtk(girModules, groupedGirModules)
        }

        if (this.config.environment === 'gjs') {
            // GJS internal stuff
            await this.exportGjs(girModules, groupedGirModules)
            await this.exportGjsCastLib(inheritanceTable)
        }

        this.log.success('Done.')
    }
}
