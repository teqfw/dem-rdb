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
export interface RdbCompatibilityDiagnostic {
    stage: 'compatibility';
    entityPath: string;
    table: string;
    reason: 'missing_check'|'unexpected_check'|'unvalidated_check'|'definition_mismatch';
    column?: string;
    constraint?: string;
    expectedCount?: number;
    actualCount?: number;
}
export type RdbRepositoryError = import('@teqfw/dem').DemRepositoryError & {details?: RdbCompatibilityDiagnostic};
export interface RdbBackend {
    execute(params: {operations: DemBatchOperation[]}): Promise<DemBatchResult>;
    get(params: {path: string}): Promise<import('@teqfw/dem').DemRepository>;
    createSchema(): Promise<void>;
    initialize(params: {scope: string; compilation: import('@teqfw/dem').DemCompilationResult}): Promise<{created: boolean; snapshot: any; application: any}>;
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
    type TeqFw_Dem_RDb_ForeignActionEvent = 'onDelete' | 'onUpdate';
    type TeqFw_Dem_RDb_Provider = import("./src/Provider.mjs").default;
    type TeqFw_Dem_RDb_Provider__Class = typeof import("./src/Provider.mjs").default;
    type TeqFw_Dem_RDb_Type_Vector_Handler = import("./src/Type/Vector/Handler.mjs").default;
    type TeqFw_Dem_RDb_Type_Vector_Handler__Class = typeof import("./src/Type/Vector/Handler.mjs").default;
    type TeqFw_Dem_RDb_Type_Vector_Provider = import("./src/Type/Vector/Provider.mjs").default;
    type TeqFw_Dem_RDb_Type_Vector_Provider__Class = typeof import("./src/Type/Vector/Provider.mjs").default;
    type TeqFw_Dem_RDb_VectorParams = {dimensions: number};
    type TeqFw_Dem_RDb_Codec_Attribute = {name: string; type: {name: string; params?: Record<string, any>; profile?: {type: string}}};
    type TeqFw_Dem_RDb_Codec_Entity = {attributes: TeqFw_Dem_RDb_Codec_Attribute[]; primaryKey: string[]|null; uniqueKeys: Record<string, string[]>; indexes: Record<string, {attributes: string[]}>; relations: Record<string, {attributes: string[]}>};
    type TeqFw_Dem_RDb_RawRow = Record<string, any>;
}
export {};
