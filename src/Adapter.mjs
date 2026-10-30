// @ts-check
/**
 * @namespace TeqFw_DemRdb_Adapter
 * @description Relational adapter for compiled DEM models.
 */
export default class Adapter {
    /**
     * @param {object} deps
     * @param {any} deps.normalize
     * @param {any} deps.selection
     * @param {any} deps.errors
     * @param {typeof import("node:crypto").createHash} deps.createHash
     */
    constructor({normalize, selection, errors, createHash}) {
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
         * @param {boolean} [pg]
         * @returns {string}
         */
        const table = (path, pg = false) => pg ? 'dem_' + createHash('sha256').update(path).digest('hex').slice(0, 32) : 'dem_' + Buffer.from(path, 'utf8').toString('hex');
        /**
         * @param {any} error
         */
        const mapError = error => {
            if (error?.name === 'DemRepositoryError') throw error;
            const message = String(error?.message ?? '');
            if (error?.code === '23505' || /UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) fail('CONFLICT', 'Unique constraint failed.');
            if (error?.code === '23503' || /FOREIGN KEY constraint failed/i.test(message)) fail('RELATION', 'Relation constraint failed.');
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
         * @param {boolean} pg
         * @returns {any}
         */
        const toDb = (entity, record, pg) => Object.fromEntries(Object.entries(record).map(([key, value]) => {
            const a = entity.attributes.find(x => x.name === key);
            if (value !== null && ['integer', 'identity', 'ref'].includes(a.type.name)) {
                const n = Number(value);
                if (!Number.isSafeInteger(n) || (pg && (n < -2147483648 || n > 2147483647))) fail('UNSUPPORTED', 'Value exceeds supported integer capacity.');
                return [key, n];
            }
            return [key, typeof value === 'boolean' ? Number(value) : value];
        }));
        /**
         * @param {object} deps
         * @param {any} deps.knex
         * @param {string} deps.path
         * @param {any} deps.entity
         * @returns {Promise<void>}
         */
        const validatePostgresql = async function ({knex, path, entity}) {
            const columns = (await knex.raw(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
                a.attnotnull AS required, COALESCE(array_position(p.conkey,a.attnum),0) AS pk,
                coll.collname AS collation, n.nspname AS schema
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
                LEFT JOIN pg_constraint p ON p.conrelid=c.oid AND p.contype='p'
                LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
                WHERE n.nspname=current_schema() AND c.relname=? AND c.relkind='r'`, [table(path, true)])).rows;
            const primary = columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
            if (columns.length !== entity.attributes.length || JSON.stringify(primary) !== JSON.stringify(entity.primaryKey ?? [])) fail('UNSUPPORTED','Database table does not match the effective model.');
            for (const attribute of entity.attributes) {
                const column = columns.find(c=>c.name===attribute.name);
                const type = ['identity','ref','integer','boolean'].includes(attribute.type.name) ? 'integer' : 'text';
                if (!column || column.type !== type || Boolean(column.required) === Boolean(attribute.nullable) || (type === 'text' && column.collation !== 'C')) fail('UNSUPPORTED','Database column does not match the effective model.');
            }
            const extraIndexes = (await knex.raw(`SELECT i.indexrelid FROM pg_index i
                JOIN pg_class rel ON rel.oid=i.indrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
                WHERE ns.nspname=current_schema() AND rel.relname=? AND i.indisunique
                AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid AND c.contype IN ('p','u'))`,[table(path, true)])).rows;
            if (extraIndexes.length) fail('UNSUPPORTED','Standalone unique indexes are unsupported.');
            const constraints = (await knex.raw(`SELECT c.contype, c.confupdtype, c.confdeltype, target.relname AS target, target_ns.nspname AS target_schema,
                ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS local_columns,
                ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS target_columns
                FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
                LEFT JOIN pg_class target ON target.oid=c.confrelid LEFT JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace
                WHERE ns.nspname=current_schema() AND rel.relname=? AND c.contype IN ('u','f')`,[table(path, true)])).rows;
            const unique = constraints.filter(c=>c.contype==='u').map(c=>JSON.stringify(c.local_columns)).sort();
            const expectedUnique = Object.values(entity.uniqueKeys).map(v=>JSON.stringify(v)).sort();
            if (JSON.stringify(unique)!==JSON.stringify(expectedUnique)) fail('UNSUPPORTED','Database uniqueness does not match the effective model.');
            const foreign = constraints.filter(c=>c.contype==='f');
            if (foreign.some(c=>!['a','r'].includes(c.confupdtype) || !['a','r'].includes(c.confdeltype) || c.target_schema !== columns[0]?.schema)) fail('UNSUPPORTED','Cascading relations are unsupported.');
            const actual = foreign.map(c=>JSON.stringify([c.target,c.local_columns,c.target_columns])).sort();
            const expected = Object.values(entity.relations).map(r=>JSON.stringify([table(r.target.path, true),r.attributes,r.target.attributes])).sort();
            if (JSON.stringify(actual)!==JSON.stringify(expected)) fail('UNSUPPORTED','Database relations do not match the effective model.');
        };
        /**
         * @param {object} deps
         * @param {any} deps.model
         * @param {any} deps.knex
         * @returns {Promise<any>}
         */
        this.open = async function ({model, knex}) {
            if (!model?.entities || typeof knex !== 'function' || !['sqlite3','pg'].includes(knex.client.config.client)) fail('UNSUPPORTED', 'A compiled model and supported Knex connection are required.');
            const pg = knex.client.config.client === 'pg';
            if (!pg && knex.client.config.pool?.max !== 1) fail('UNSUPPORTED', 'SQLite requires a single connection pool.');
            if (pg && Object.values(model.entities).some(entity => entity.attributes.some(a => Buffer.byteLength(a.name) > 63))) fail('UNSUPPORTED', 'PostgreSQL identifier length exceeds supported limits.');
            for (const entity of Object.values(model.entities)) supported(entity);
            try {
                if (!pg) await knex.raw('PRAGMA foreign_keys = ON');
                else if ((await knex.raw("SHOW server_encoding")).rows[0].server_encoding !== 'UTF8') fail('UNSUPPORTED', 'PostgreSQL requires UTF8 encoding.');
            } catch (e) { mapError(e); }
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
                try {
                    if (pg) await validatePostgresql({knex, path, entity});
                    else {
                    const columns = await knex.raw('SELECT name, type, "notnull" AS required, pk FROM pragma_table_info(?)', [table(path, pg)]);
                    const primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
                    if (columns.length !== entity.attributes.length || JSON.stringify(primary) !== JSON.stringify(entity.primaryKey ?? []))
                        fail('UNSUPPORTED', 'Database table does not match the effective model.');
                    for (const attribute of entity.attributes) {
                        const column = columns.find(value => value.name === attribute.name);
                        const type = ['identity','ref','integer','boolean'].includes(attribute.type.name) ? 'INTEGER' : 'TEXT';
                        if (!column || column.type.toUpperCase() !== type || (attribute.nullable ? Boolean(column.required || column.pk) : !column.required && !column.pk))
                            fail('UNSUPPORTED', 'Database column does not match the effective model.');
                    }
                    const actualIndexes = await knex.raw('SELECT name, "unique" AS is_unique, origin, partial FROM pragma_index_list(?)', [table(path, pg)]);
                    const actualUnique = [];
                    for (const index of actualIndexes) {
                        if (!index.is_unique || index.origin === 'pk') continue;
                        if (index.partial) fail('UNSUPPORTED', 'Partial unique indexes are unsupported.');
                        const keys = await knex.raw('SELECT name, coll, "key" AS is_key FROM pragma_index_xinfo(?) ORDER BY seqno', [index.name]);
                        const members = keys.filter(key => key.is_key);
                        if (members.some(key => !key.name || key.coll !== 'BINARY')) fail('UNSUPPORTED', 'Unsupported unique index collation.');
                        actualUnique.push(JSON.stringify(members.map(key => key.name)));
                    }
                    const expectedUnique = Object.values(entity.uniqueKeys).map(key => JSON.stringify(key)).sort();
                    if (JSON.stringify(actualUnique.sort()) !== JSON.stringify(expectedUnique))
                        fail('UNSUPPORTED', 'Database uniqueness does not match the effective model.');
                    const foreignKeys = await knex.raw('SELECT id, seq, "table" AS target_table, "from" AS local_name, "to" AS target_name, on_update, on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq', [table(path, pg)]);
                    const actualRelations = [];
                    for (const id of new Set(foreignKeys.map(key => key.id))) {
                        const group = foreignKeys.filter(key => key.id === id);
                        if (group.some(key => !['NO ACTION','RESTRICT'].includes(key.on_update) || !['NO ACTION','RESTRICT'].includes(key.on_delete)))
                            fail('UNSUPPORTED', 'Cascading relations are unsupported.');
                        actualRelations.push(JSON.stringify([group[0].target_table, group.map(key => key.local_name), group.map(key => key.target_name)]));
                    }
                    const expectedRelations = Object.values(entity.relations).map(relation => JSON.stringify([table(relation.target.path, pg), relation.attributes, relation.target.attributes])).sort();
                    if (JSON.stringify(actualRelations.sort()) !== JSON.stringify(expectedRelations))
                        fail('UNSUPPORTED', 'Database relations do not match the effective model.');
                    }
                } catch (error) { mapError(error); }
                /**
                 * @param {any} input
                 * @returns {any}
                 */
                const key = input => toDb(entity, normalize.key({entity, key: input}).values, pg);
                /**
                 * @returns {any}
                 */
                const query = () => knex(table(path, pg));
                /**
                 * @param {any} fn
                 * @returns {Promise<any>}
                 */
                const wrap = async fn => { try { return await fn(); } catch (e) { mapError(e); } };
                return {
                    create: async params => wrap(async () => {
                        shape(params, ['record']);
                        const value = toDb(entity, normalize.record({entity, record: params.record, mode:'create'}), pg);
                        return knex.transaction(async trx => {
                            if (!pg) await ensureForeignKeys(trx);
                            const generated = entity.attributes.find(a => a.type.name === 'identity' && a.generation);
                            if (pg && generated) {
                                await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [table(path, pg)]);
                                if (!Object.hasOwn(value, generated.name)) {
                                    const highest = await trx(table(path, pg)).max({value:generated.name}).first();
                                    const next = Number(highest.value ?? 0) + 1;
                                    if (next > 2147483647) fail('STORAGE', 'Identity capacity exhausted.');
                                    value[generated.name] = next;
                                }
                            }
                            const rows = await trx(table(path, pg)).insert(value).returning('*');
                            return {record: fromDb(entity, rows[0])};
                        });
                    }),
                    read: async params => wrap(async () => { shape(params, ['key']); return {record: fromDb(entity, await query().where(key(params.key)).first())}; }),
                    update: async params => wrap(async () => {
                        shape(params, ['key', 'changes']);
                        const values = key(params.key), changes = toDb(entity, normalize.record({entity, record:params.changes, mode:'update'}), pg);
                        return knex.transaction(async trx => {
                            if (!pg) await ensureForeignKeys(trx);
                            const rows = await trx(table(path, pg)).where(values).update(changes).returning('*');
                            return {record: fromDb(entity, rows[0])};
                        });
                    }),
                    delete: async params => wrap(async () => { shape(params, ['key']); const values = key(params.key); return knex.transaction(async trx => { if (!pg) await ensureForeignKeys(trx); return {deleted: (await trx(table(path, pg)).where(values).delete()) > 0}; }); }),
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
                            return {sql:`(?? IS NOT NULL AND ?? ${symbols[op]} ?)`, bindings:[name,name,toDb(entity,{[name]:value}, pg)[name]]};
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
                        if (!pg) await ensureForeignKeys(trx);
                        for (const [path,entity] of Object.entries(model.entities)) {
                            if (await trx.schema.hasTable(table(path, pg))) fail('CONFLICT', 'Target table already exists.');
                            await trx.schema.createTable(table(path, pg), t => {
                                for (const a of entity.attributes) {
                                    let c;
                                    if (a.type.name === 'identity' && a.generation) { if (pg) t.integer(a.name).primary(); else t.increments(a.name); continue; }
                                    if (['identity','ref','integer','boolean'].includes(a.type.name)) c = t.integer(a.name);
                                    else c = pg ? t.specificType(a.name, 'text COLLATE "C"') : t.text(a.name);
                                    if (!a.nullable) c.notNullable();
                                }
                                if (entity.primaryKey && !entity.attributes.some(a => a.type.name === 'identity' && a.generation)) t.primary(entity.primaryKey);
                                for (const [name, columns] of Object.entries(entity.uniqueKeys)) t.unique(columns, pg ? `${table(path, pg)}_u_${createHash('sha256').update(name).digest('hex').slice(0, 16)}` : `${table(path, pg)}_u_${name}`);
                                for (const [name, columns] of Object.entries(entity.indexes)) t.index(columns.attributes, pg ? `${table(path, pg)}_i_${createHash('sha256').update(name).digest('hex').slice(0, 16)}` : `${table(path, pg)}_i_${name}`);
                                if (!pg) for (const [index, relation] of Object.values(entity.relations).entries()) t.foreign(relation.attributes, `${table(path, pg)}_f_${index}`).references(relation.target.attributes).inTable(table(relation.target.path, pg));
                            });
                        }
                        if (pg) for (const [path, entity] of Object.entries(model.entities)) {
                            await trx.schema.alterTable(table(path, pg), t => {
                                for (const [index, relation] of Object.values(entity.relations).entries()) t.foreign(relation.attributes, `${table(path, pg)}_f_${index}`).references(relation.target.attributes).inTable(table(relation.target.path, pg));
                            });
                        }
                    });
                } catch (e) { mapError(e); }
            };
            return {get, createSchema};
        };
    }
}
export const __deps__ = Object.freeze({default:Object.freeze({normalize:'TeqFw_Dem_Repository_Normalize$', selection:'TeqFw_Dem_Dto_Query_Selection__Factory$', errors:'TeqFw_Dem_Repository_Error$',createHash:'node:crypto__createHash'})});
