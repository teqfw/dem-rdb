import type {Knex} from 'knex';
import type {DemModel, DemRepositoryProvider} from '@teqfw/dem';

export interface RdbConfiguration {
    model: DemModel;
    knex: Knex;
}
export interface RdbConfigurationProvider {
    get(): Promise<RdbConfiguration>;
}
export interface RdbBackend {
    get(params: {path: string}): Promise<import('@teqfw/dem').DemRepository>;
    createSchema(): Promise<void>;
}
export interface RdbAdapter {
    open(configuration: RdbConfiguration): Promise<RdbBackend>;
}

declare global {
    type TeqFw_DemRdb_Adapter = import("./src/Adapter.mjs").default;
    type TeqFw_DemRdb_Adapter__Class = typeof import("./src/Adapter.mjs").default;
    type TeqFw_DemRdb_Api_Configuration = import("./src/Api/Configuration.mjs").default;
    type TeqFw_DemRdb_Api_Configuration__Class = typeof import("./src/Api/Configuration.mjs").default;
    type TeqFw_DemRdb_Provider = import("./src/Provider.mjs").default;
    type TeqFw_DemRdb_Provider__Class = typeof import("./src/Provider.mjs").default;
}
export {};
