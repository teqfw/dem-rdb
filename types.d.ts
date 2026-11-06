import type {DemModel, DemRepositoryProvider, DemBatchOperation, DemBatchResult} from '@teqfw/dem';

export interface RdbRuntime {
    model: DemModel;
    normalize: {value: (...args: any[]) => any; record: (...args: any[]) => any; key: (...args: any[]) => any};
    selection: {create: (...args: any[]) => any};
    select: {exec: (...args: any[]) => any};
    batch: {validate: (...args: any[]) => any; plan: (...args: any[]) => any};
}

export interface RdbConfiguration {
    model: DemModel;
    projection?: 'native' | 'portable';
    name?: string;
    enforceRelations?: boolean;
    /** DEM Runtime binding for model-scoped Core or extension operations. */
    runtime?: RdbRuntime;
}
export interface RdbConnection {
    init(configuration: Readonly<Record<string, any>>): Promise<void>;
    getClient(): import('knex').Knex;
    disconnect(): Promise<void>;
}
export interface RdbConfigurationProvider {
    get(): Promise<RdbConfiguration>;
}
export interface RdbBackend {
    execute(params: {operations: DemBatchOperation[]}): Promise<DemBatchResult>;
    get(params: {path: string}): Promise<import('@teqfw/dem').DemRepository>;
    createSchema(options?: {publish?: boolean}): Promise<void | {version: number}>;
    getSchemaHistory(): Promise<{schemas: {version: number; model: DemModel}[]}>;
    close(): Promise<void>;
}
export interface RdbAdapter {
    open(configuration: RdbConfiguration & {connection: RdbConnection}): Promise<RdbBackend>;
}

declare global {
    type TeqFw_Dem_RDb_Adapter = import("./src/Adapter.mjs").default;
    type TeqFw_Dem_RDb_Adapter__Class = typeof import("./src/Adapter.mjs").default;
    type TeqFw_Dem_RDb_Api_Configuration = import("./src/Api/Configuration.mjs").default;
    type TeqFw_Dem_RDb_Api_Configuration__Class = typeof import("./src/Api/Configuration.mjs").default;
    type TeqFw_Dem_RDb_Codec = import("./src/Codec.mjs").default;
    type TeqFw_Dem_RDb_Codec__Class = typeof import("./src/Codec.mjs").default;
    type TeqFw_Dem_RDb_Config = import("./src/Config.mjs").default;
    type TeqFw_Dem_RDb_Config__Class = typeof import("./src/Config.mjs").default;
    type TeqFw_Dem_RDb_Connection = import("./src/Connection.mjs").default;
    type TeqFw_Dem_RDb_Connection__Class = typeof import("./src/Connection.mjs").default;
    type TeqFw_Dem_RDb_Portable = import("./src/Portable.mjs").default;
    type TeqFw_Dem_RDb_Portable__Class = typeof import("./src/Portable.mjs").default;
    type TeqFw_Dem_RDb_Provider = import("./src/Provider.mjs").default;
    type TeqFw_Dem_RDb_Provider__Class = typeof import("./src/Provider.mjs").default;
}
export {};
