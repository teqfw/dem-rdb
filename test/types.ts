import type {RdbAdapter, RdbConfiguration, RdbBackend} from '../types.js';

declare const adapter: RdbAdapter;
declare const config: RdbConfiguration;
async function check(): Promise<RdbBackend> {
    const backend = await adapter.open(config);
    await backend.createSchema();
    await backend.get({path:'/app/item'});
    return backend;
}
void check;
