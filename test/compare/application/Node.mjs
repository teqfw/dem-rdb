// @ts-check
import Container from '@teqfw/di';
import knex from 'knex';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {source} from '@teqfw/dem/conformance/application/schema';

/** Host-owned configuration, initialized before application resolution. */
export class Configuration {
    constructor() {
        let options;
        this.set = value => { options = value; };
        this.get = async () => { if (!options) throw new Error('Host is not configured.'); return options; };
    }
}
/** Select the provider implementation and host configuration through DI. */
export function Preprocessor() {
    return id => id.address === 'TeqFw_Dem_Api_RepositoryProvider'
        ? {...id, address: 'TeqFw_DemRdb_Provider'}
        : id.address === 'TeqFw_DemRdb_Api_Configuration'
            ? {...id, address: 'Host_Node', exportName: 'Configuration'} : id;
}

/** Execute the shared application in an isolated temporary SQLite file. */
export async function run() {
    const directory = await mkdtemp(join(tmpdir(), 'dem-application-'));
    const db = knex({client: 'sqlite3', connection: {filename: join(directory, 'tasks.sqlite')},
        useNullAsDefault: true, pool: {min: 1, max: 1}});
    let backend, provider;
    try {
        const applicationUrl = import.meta.resolve('@teqfw/dem/conformance/application');
        const container = new Container({
            namespaces: [
                {prefix: 'TeqFw_Dem_', target: fileURLToPath(new URL('../src', import.meta.resolve('@teqfw/dem/conformance'))), defaultExt: '.mjs'},
                {prefix: 'TeqFw_DemRdb_', target: fileURLToPath(new URL('../../../src', import.meta.url)), defaultExt: '.mjs'},
                {prefix: 'Demo_', target: dirname(fileURLToPath(applicationUrl)), defaultExt: '.mjs'},
                {prefix: 'Host_', target: fileURLToPath(new URL('./', import.meta.url)), defaultExt: '.mjs'},
            ], preprocessors: ['Host_Node__Preprocessor$'],
        });
        const compiler = await container.get('TeqFw_Dem_Compile$');
        const {model, fingerprint} = await compiler.exec({schemas: [source]});
        const configuration = await container.get('Host_Node__Configuration$');
        configuration.set({model, knex: db});
        const adapter = await container.get('TeqFw_DemRdb_Adapter$');
        backend = await adapter.open(await configuration.get());
        await backend.createSchema();
        provider = await container.get('TeqFw_Dem_Api_RepositoryProvider$');
        const application = await container.get('Demo_Workflow$');
        const transcript = await application.exec({model});
        const applicationHash = createHash('sha256').update(await readFile(new URL(applicationUrl))).digest('hex');
        return {model, fingerprint, transcript, applicationHash};
    } finally {
        try { try { await provider?.close(); } finally { await backend?.close(); } }
        finally { try { await db.destroy(); } finally { await rm(directory, {recursive: true, force: true}); } }
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    run().then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
