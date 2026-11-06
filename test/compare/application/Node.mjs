// @ts-check
import Container from '@teqfw/di';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {source} from '@teqfw/dem/conformance/application/schema';

/** Execute the shared application in an isolated temporary SQLite file. */
export async function run() {
    const directory = await mkdtemp(join(tmpdir(), 'dem-application-'));
    let backend, provider, connection;
    try {
        const applicationUrl = import.meta.resolve('@teqfw/dem/conformance/application');
        const container = new Container({
            namespaces: [
                {prefix: 'TeqFw_Dem_', target: fileURLToPath(new URL('../src', import.meta.resolve('@teqfw/dem/conformance'))), defaultExt: '.mjs'},
                {prefix: 'TeqFw_Dem_RDb_', target: fileURLToPath(new URL('../../../src', import.meta.url)), defaultExt: '.mjs'},
                {prefix: 'TeqFw_Cfg_', target: fileURLToPath(new URL('../src', import.meta.resolve('@teqfw/cfg/src/Reader.mjs'))), defaultExt: '.mjs'},
                {prefix: 'Demo_', target: dirname(fileURLToPath(applicationUrl)), defaultExt: '.mjs'},
                {prefix: 'Host_', target: fileURLToPath(new URL('./Host', import.meta.url)), defaultExt: '.mjs'},
            ], preprocessors: ['Host_Node_Preprocessor$'],
        });
        const loader = await container.get('TeqFw_Cfg_Loader$');
        await loader.load([{id:'comparison',load:async()=>[
            {key:'TEQFW_DEM_RDB__CLIENT',value:'sqlite3'},
            {key:'TEQFW_DEM_RDB__FILENAME',value:join(directory,'tasks.sqlite')},
            {key:'TEQFW_DEM_RDB__USE_NULL_AS_DEFAULT',value:true},
            {key:'TEQFW_DEM_RDB__EXTRA',value:{pool:{min:1,max:1}}},
        ]}]);
        (await container.get('TeqFw_Dem_Registry$')).finalize();
        const compiler = await container.get('TeqFw_Dem_Compile$');
        const {model, fingerprint} = await compiler.exec({schemas: [source]});
        const configuration = await container.get('Host_Node_Configuration$');
        configuration.set({model, projection:'portable', name:'application'});
        const rdbConfig = await container.get('TeqFw_Dem_RDb_Config$');
        connection = await container.get('TeqFw_Dem_RDb_Connection$');
        await connection.init(rdbConfig.get());
        const adapter = await container.get('TeqFw_Dem_RDb_Adapter$');
        backend = await adapter.open({...await configuration.get(),connection});
        await backend.createSchema();
        const application = await container.get('Demo_Workflow$');
        const transcript = await application.exec({model});
        provider = await container.get('Host_Node_Provider$');
        const applicationHash = createHash('sha256').update(await readFile(new URL(applicationUrl))).digest('hex');
        return {model, fingerprint, transcript, applicationHash};
    } finally {
        try { try { await provider?.close(); } finally { await backend?.close(); } }
        finally { try { await connection?.disconnect(); } finally { await rm(directory, {recursive: true, force: true}); } }
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    run().then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
