import type {RdbAdapter, RdbConfiguration, RdbBackend, RdbRuntime} from '../types.js';

declare const adapter: RdbAdapter;
declare const config: RdbConfiguration;
declare const runtime: RdbRuntime;
const configWithRuntime: RdbConfiguration = {...config, runtime};
void configWithRuntime;
async function check(): Promise<RdbBackend> {
    const backend = await adapter.open(config);
    await backend.createSchema();
    await backend.get({path:'/app/item'});
    return backend;
}
void check;

async function batchTypes(backend: RdbBackend) {
    await backend.execute({operations:[{path:'/app/item',method:'list',params:{selection:{}}}]});
    // @ts-expect-error create requires record, not a selection
    await backend.execute({operations:[{path:'/app/item',method:'create',params:{selection:{}}}]});
}
void batchTypes;
