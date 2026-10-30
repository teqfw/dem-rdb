// @ts-check
/**
 * @namespace TeqFw_DemRdb_Adapter
 * @description SQLite adapter for compiled DEM models.
 */
export default class Adapter {
    /**
     * @param {object} deps
     * @param {any} deps.normalize
     * @param {any} deps.selection
     * @param {any} deps.errors
     */
    constructor({normalize, selection, errors}) {
        /**
         * @param {any} code
         * @param {string} message
         */
        const fail = (code, message) => { throw errors.create({code, message}); };
        /**
         * @param {any} arg
         * @param {Array<string>} fields
         */
        const shape = (arg, fields) => {
            if (!arg || typeof arg !== 'object' || Array.isArray(arg) || Object.keys(arg).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(arg, k))) fail('INVALID_INPUT', 'Invalid parameters.');
        };
        /**
         * @param {string} path
         * @returns {string}
         */
        const table = path => 'dem_' + Buffer.from(path, 'utf8').toString('hex');
        /**
         * @param {any} error
         */
        const mapError = error => {
            if (error?.name === 'DemRepositoryError') throw error;
            const message = String(error?.message ?? '');
            if (/UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) fail('CONFLICT', 'Unique constraint failed.');
            if (/FOREIGN KEY constraint failed/i.test(message)) fail('RELATION', 'Relation constraint failed.');
            fail('STORAGE', 'Relational storage operation failed.');
        };
        /**
         * @param {any} entity
         */
        const supported = entity => {
            for (const a of entity.attributes) {
                const n = a.type.name;
                if (!['identity', 'ref', 'integer', 'boolean', 'string', 'text', 'uuid', 'enum', 'date'].includes(n)) fail('UNSUPPORTED', 'Unsupported logical type: ' + n);
                if ((n === 'identity' || n === 'ref') && a.type.profile?.type !== 'int') fail('UNSUPPORTED', 'Only integer identity profiles are supported.');
                if (n === 'integer' && (a.type.params?.bits === 64 || a.type.params?.unsigned && a.type.params?.bits === 32)) fail('UNSUPPORTED', 'Integer capacity exceeds exact SQLite JavaScript support.');
                if (a.generation && !(n === 'identity' && entity.primaryKey?.length === 1)) fail('UNSUPPORTED', 'Unsupported generation.');
            }
        };
        /**
         * @param {any} trx
         * @returns {Promise<void>}
         */
        const ensureForeignKeys = async trx => {
            const rows = await trx.raw('PRAGMA foreign_keys');
            if (Number(rows?.[0]?.foreign_keys) !== 1) fail('UNSUPPORTED', 'SQLite foreign key enforcement is disabled.');
        };
        /**
         * @param {any} entity
         * @param {any} row
         * @returns {any}
         */
        const fromDb = (entity, row) => {
            if (!row) return null;
            const result = {};
            for (const a of entity.attributes) {
                let v = row[a.name];
                if (v !== null && ['identity', 'ref', 'integer'].includes(a.type.name)) {
                    if (!Number.isSafeInteger(v)) fail('STORAGE', 'Stored integer exceeds supported capacity.');
                    v = String(v);
                }
                if (v !== null && a.type.name === 'boolean') v = Boolean(v);
                result[a.name] = v;
            }
            return normalize.record({entity, record: result, mode: 'complete'});
        };
        /**
         * @param {any} entity
         * @param {any} record
         * @returns {any}
         */
        const toDb = (entity, record) => Object.fromEntries(Object.entries(record).map(([key, value]) => {
            const a = entity.attributes.find(x => x.name === key);
            if (value !== null && ['integer', 'identity', 'ref'].includes(a.type.name)) {
                const n = Number(value);
                if (!Number.isSafeInteger(n)) fail('UNSUPPORTED', 'Value exceeds supported integer capacity.');
                return [key, n];
            }
            return [key, typeof value === 'boolean' ? Number(value) : value];
        }));
        /**
         * @param {object} deps
         * @param {any} deps.model
         * @param {any} deps.knex
         * @returns {Promise<any>}
         */
        this.open = async function ({model, knex}) {
            if (!model?.entities || typeof knex !== 'function' || knex.client.config.client !== 'sqlite3') fail('UNSUPPORTED', 'A compiled model and SQLite Knex connection are required.');
            if (knex.client.config.pool?.max !== 1) fail('UNSUPPORTED', 'SQLite requires a single connection pool.');
            for (const entity of Object.values(model.entities)) supported(entity);
            try { await knex.raw('PRAGMA foreign_keys = ON'); } catch (e) { mapError(e); }
            /**
             * @param {any} params
             * @returns {Promise<any>}
             */
            const get = async function (params) {
                shape(params, ['path']);
                const {path} = params;
                if (typeof path !== 'string' || !/^\/(?:[a-z0-9_]+)(?:\/[a-z0-9_]+)*$/.test(path)) fail('INVALID_INPUT', 'Expected a canonical entity path.');
                const entity = model.entities[path];
                if (!entity) fail('NOT_FOUND', 'Entity not found.');
                /**
                 * @param {any} input
                 * @returns {any}
                 */
                const key = input => toDb(entity, normalize.key({entity, key: input}).values);
                /**
                 * @returns {any}
                 */
                const query = () => knex(table(path));
                /**
                 * @param {any} fn
                 * @returns {Promise<any>}
                 */
                const wrap = async fn => { try { return await fn(); } catch (e) { mapError(e); } };
                return {
                    create: async params => wrap(async () => {
                        shape(params, ['record']);
                        const value = toDb(entity, normalize.record({entity, record: params.record, mode:'create'}));
                        return knex.transaction(async trx => {
                            await ensureForeignKeys(trx);
                            const rows = await trx(table(path)).insert(value).returning('*');
                            return {record: fromDb(entity, rows[0])};
                        });
                    }),
                    read: async params => wrap(async () => { shape(params, ['key']); return {record: fromDb(entity, await query().where(key(params.key)).first())}; }),
                    update: async params => wrap(async () => {
                        shape(params, ['key', 'changes']);
                        const values = key(params.key), changes = toDb(entity, normalize.record({entity, record:params.changes, mode:'update'}));
                        return knex.transaction(async trx => {
                            await ensureForeignKeys(trx);
                            const rows = await trx(table(path)).where(values).update(changes).returning('*');
                            return {record: fromDb(entity, rows[0])};
                        });
                    }),
                    delete: async params => wrap(async () => { shape(params, ['key']); const values = key(params.key); return knex.transaction(async trx => { await ensureForeignKeys(trx); return {deleted: (await trx(table(path)).where(values).delete()) > 0}; }); }),
                    list: async params => wrap(async () => {
                        shape(params, ['selection']);
                        const s = selection.create({entity, selection:params.selection});
                        /**
                         * @param {any} node
                         * @returns {any}
                         */
                        const expr = node => {
                            const op = node.operator, args = node.args;
                            if (op === 'and' || op === 'or') { const parts = args.map(expr); return {sql:'(' + parts.map(p => p.sql).join(op === 'and' ? ' AND ' : ' OR ') + ')', bindings:parts.flatMap(p => p.bindings)}; }
                            if (op === 'not') { const p = expr(args[0]); return {sql:'(NOT ' + p.sql + ')', bindings:p.bindings}; }
                            const name = args[0].name;
                            if (op === 'isNull' || op === 'isNotNull') return {sql:op === 'isNull' ? '?? IS NULL' : '?? IS NOT NULL', bindings:[name]};
                            const value = args[1].value;
                            if (value === null) return {sql:'0 = 1', bindings:[]};
                            const symbols = {eq:'=',ne:'<>',lt:'<',lte:'<=',gt:'>',gte:'>='};
                            return {sql:`(?? IS NOT NULL AND ?? ${symbols[op]} ?)`, bindings:[name,name,toDb(entity,{[name]:value})[name]]};
                        };
                        let q = query().select('*');
                        if (s.where) { const p = expr(s.where); q = q.whereRaw(p.sql,p.bindings); }
                        for (const o of s.orderBy) { q = q.orderByRaw('?? IS NULL ' + (o.nulls === 'first' ? 'DESC' : 'ASC'), [o.attribute]).orderBy(o.attribute,o.direction); }
                        if (s.limit !== null) q = q.limit(s.limit);
                        if (s.offset) q = q.offset(s.offset);
                        return {records:(await q).map(row => fromDb(entity,row))};
                    }),
                };
            };
            /**
             * @returns {Promise<void>}
             */
            const createSchema = async function () {
                try {
                    await knex.transaction(async trx => {
                        await ensureForeignKeys(trx);
                        for (const [path,entity] of Object.entries(model.entities)) {
                            if (await trx.schema.hasTable(table(path))) fail('CONFLICT', 'Target table already exists.');
                            await trx.schema.createTable(table(path), t => {
                                for (const a of entity.attributes) {
                                    let c;
                                    if (a.type.name === 'identity' && a.generation) { t.increments(a.name); continue; }
                                    if (['identity','ref','integer','boolean'].includes(a.type.name)) c = t.integer(a.name);
                                    else c = t.text(a.name);
                                    if (!a.nullable) c.notNullable();
                                }
                                if (entity.primaryKey && !entity.attributes.some(a => a.type.name === 'identity' && a.generation)) t.primary(entity.primaryKey);
                                for (const [name, columns] of Object.entries(entity.uniqueKeys)) t.unique(columns, `${table(path)}_u_${name}`);
                                for (const [name, columns] of Object.entries(entity.indexes)) t.index(columns.attributes, `${table(path)}_i_${name}`);
                                for (const relation of Object.values(entity.relations)) t.foreign(relation.attributes).references(relation.target.attributes).inTable(table(relation.target.path));
                            });
                        }
                    });
                } catch (e) { mapError(e); }
            };
            return {get, createSchema};
        };
    }
}
export const __deps__ = Object.freeze({default:Object.freeze({normalize:'TeqFw_Dem_Repository_Normalize$', selection:'TeqFw_Dem_Dto_Query_Selection__Factory$', errors:'TeqFw_Dem_Repository_Error$'})});
