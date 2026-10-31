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
     * @param {any} deps.codec
     * @param {any} deps.evaluate
     * @param {typeof import("node:crypto").randomUUID} deps.randomUUID
     * @param {typeof import("node:crypto").createHash} deps.createHash
     */
    constructor({normalize, selection, errors, createHash, codec, evaluate, randomUUID}) {
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
            if (error?.code === 'ER_DUP_ENTRY') fail('CONFLICT', 'Unique constraint failed.');
            if (['ER_NO_REFERENCED_ROW_2','ER_ROW_IS_REFERENCED_2'].includes(error?.code)) fail('RELATION', 'Relation constraint failed.');
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
                if (!['identity','ref','integer','boolean','string','text','uuid','enum','date','datetime','decimal','binary','json','vector'].includes(n)) fail('UNSUPPORTED', 'Unsupported logical type: ' + n);
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
        const fromDb = (entity,row) => codec.decode(entity,row);
        /**
         * @param {any} entity
         * @param {any} record
         * @param {boolean} pg
         * @param {boolean} mysql
         * @returns {any}
         */
        const toDb = (entity,record,pg,mysql) => codec.encode({entity,record,dialect:pg ? 'pg' : mysql ? 'mysql2' : 'sqlite3'});
        /**
         * @param {any} entity
         * @param {any} connection
         * @returns {Array<any>}
         */
        const projection = function (entity,connection) {
            return entity.attributes.map(a=>codec.numeric(a) || a.type.name==='decimal' && !['text','longblob','varbinary(512)'].includes(codec.type({attribute:a,dialect:connection.client.config.client,indexed:codec.indexed(entity,a.name)}))
                ? connection.raw('CAST(?? AS '+(connection.client.config.client==='mysql2' ? 'CHAR' : 'TEXT')+') AS ??',[a.name,a.name]) : a.name);
        };
        /**
         * @param {object} deps
         * @param {any} deps.knex
         * @param {string} deps.path
         * @param {any} deps.entity
         * @returns {Promise<void>}
         */
        const validateMariadb = async function ({knex, path, entity}) {
            const name = table(path, true);
            const [tables] = await knex.raw('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [name]);
            if (tables.length !== 1 || tables[0].engine !== 'InnoDB') fail('UNSUPPORTED','MariaDB table must use InnoDB.');
            const [columns] = await knex.raw('SELECT COLUMN_NAME AS name, DATA_TYPE AS type, COLUMN_TYPE AS column_type, EXTRA AS extra, CHARACTER_MAXIMUM_LENGTH AS width, NUMERIC_PRECISION AS numeric_precision, NUMERIC_SCALE AS numeric_scale, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [name]);
            if (columns.length !== entity.attributes.length) fail('UNSUPPORTED','Database table does not match the effective model.');
            for (const attribute of entity.attributes) {
                const column = columns.find(c=>c.name===attribute.name);
                const expected = codec.type({attribute, dialect:'mysql2', indexed:codec.indexed(entity,attribute.name)});
                const type = expected.startsWith('decimal(') ? 'decimal' : expected.split(/[ (]/)[0];
                const decimal = /^decimal\((\d+),(\d+)\)$/.exec(expected);
                if (decimal && (Number(column?.numeric_precision)!==Number(decimal[1]) || Number(column?.numeric_scale)!==Number(decimal[2]))) fail('UNSUPPORTED','Database decimal precision does not match the model.');
                const generated = attribute.type.name === 'identity' && attribute.type.profile.type === 'int' && attribute.generation;
                if (!column || column.type !== (type==='integer' ? 'int' : type) || (expected==='varbinary(512)' && Number(column.width)!==512) || (/unsigned/i.test(column.column_type) !== expected.includes('unsigned')) || (column.extra.includes('auto_increment') !== Boolean(generated)) || (column.nullable === 'YES') !== attribute.nullable)
                    fail('UNSUPPORTED','Database column does not match the effective model.');
            }
            const [indexes] = await knex.raw('SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position, SUB_PART AS prefix_length FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [name]);
            const primary = indexes.filter(i=>i.name==='PRIMARY').map(i=>i.column_name);
            if (JSON.stringify(primary) !== JSON.stringify(entity.primaryKey ?? [])) fail('UNSUPPORTED','Database primary key does not match the model.');
            const actualUnique = [];
            for (const indexName of new Set(indexes.filter(i=>Number(i.non_unique)===0 && i.name!=='PRIMARY').map(i=>i.name))) {
                const members = indexes.filter(i=>i.name===indexName);
                if (members.some(i=>i.prefix_length !== null || !i.column_name)) fail('UNSUPPORTED','Partial or expression unique indexes are unsupported.');
                actualUnique.push(JSON.stringify(members.map(i=>i.column_name)));
            }
            const expectedUnique = Object.values(entity.uniqueKeys).map(v=>JSON.stringify(v)).sort();
            if (JSON.stringify(actualUnique.sort()) !== JSON.stringify(expectedUnique)) fail('UNSUPPORTED','Database uniqueness does not match the effective model.');
            const [relations] = await knex.raw(`SELECT k.CONSTRAINT_NAME AS name,k.ORDINAL_POSITION AS position,k.COLUMN_NAME AS local_name,
                k.REFERENCED_TABLE_NAME AS target_table,k.REFERENCED_COLUMN_NAME AS target_name,k.REFERENCED_TABLE_SCHEMA AS target_schema,
                r.UPDATE_RULE AS on_update,r.DELETE_RULE AS on_delete,DATABASE() AS active_schema
                FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
                WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`, [name]);
            const actualRelations = [];
            for (const relationName of new Set(relations.map(r=>r.name))) {
                const group = relations.filter(r=>r.name===relationName);
                if (group.some(r=>!['NO ACTION','RESTRICT'].includes(r.on_update) || !['NO ACTION','RESTRICT'].includes(r.on_delete) || r.target_schema !== r.active_schema)) fail('UNSUPPORTED','Unsupported foreign key behavior.');
                actualRelations.push(JSON.stringify([group[0].target_table,group.map(r=>r.local_name),group.map(r=>r.target_name)]));
            }
            const expectedRelations = Object.values(entity.relations).map(r=>JSON.stringify([table(r.target.path,true),r.attributes,r.target.attributes])).sort();
            if (JSON.stringify(actualRelations.sort()) !== JSON.stringify(expectedRelations)) fail('UNSUPPORTED','Database relations do not match the effective model.');
        };
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
                const type = codec.type({attribute,dialect:'pg',indexed:codec.indexed(entity,attribute.name)});
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
            if (!model?.entities || typeof knex !== 'function' || !['sqlite3','pg','mysql2'].includes(knex.client.config.client)) fail('UNSUPPORTED', 'A compiled model and supported Knex connection are required.');
            const pg = knex.client.config.client === 'pg';
            const mysql = knex.client.config.client === 'mysql2';
            const hashed = pg || mysql;
            if (!hashed && knex.client.config.pool?.max !== 1) fail('UNSUPPORTED', 'SQLite requires a single connection pool.');
            if (hashed && Object.values(model.entities).some(entity => entity.attributes.some(a => Buffer.byteLength(a.name) > (pg ? 63 : 64)))) fail('UNSUPPORTED', 'PostgreSQL identifier length exceeds supported limits.');
            for (const entity of Object.values(model.entities)) {
                supported(entity);
                if (mysql) for (const key of [entity.primaryKey, ...Object.values(entity.uniqueKeys), ...Object.values(entity.indexes).map(index => index.attributes)]) {
                    if (key && key.reduce((sum, name) => { const a = entity.attributes.find(item => item.name === name); return sum + (codec.type({attribute:a,dialect:'mysql2',indexed:true}) === 'integer' ? 4 : codec.numeric(a) ? 8 : 512); }, 0) > 3072) fail('UNSUPPORTED', 'MariaDB index exceeds supported width.');
                }
            }
            try {
                if (!hashed) await knex.raw('PRAGMA foreign_keys = ON');
                else if (mysql) {
                    const [rows] = await knex.raw('SELECT @@innodb_page_size AS page_size, @@sql_mode AS sql_mode, @@foreign_key_checks AS foreign_keys');
                    if (Number(rows[0].page_size) !== 16384 || !/(?:^|,)STRICT_(?:ALL|TRANS)_TABLES(?:,|$)/.test(String(rows[0].sql_mode)) || Number(rows[0].foreign_keys) !== 1) fail('UNSUPPORTED', 'MariaDB requires strict mode, foreign keys and 16 KiB InnoDB pages.');
                }
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
                    else if (mysql) await validateMariadb({knex, path, entity});
                    else {
                    const columns = await knex.raw('SELECT name, type, "notnull" AS required, pk FROM pragma_table_info(?)', [table(path, hashed)]);
                    const primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
                    if (columns.length !== entity.attributes.length || JSON.stringify(primary) !== JSON.stringify(entity.primaryKey ?? []))
                        fail('UNSUPPORTED', 'Database table does not match the effective model.');
                    for (const attribute of entity.attributes) {
                        const column = columns.find(value => value.name === attribute.name);
                        const type = codec.type({attribute,dialect:'sqlite3',indexed:codec.indexed(entity,attribute.name)}).toUpperCase();
                        if (!column || column.type.toUpperCase() !== type || (attribute.nullable ? Boolean(column.required || column.pk) : !column.required && !column.pk))
                            fail('UNSUPPORTED', 'Database column does not match the effective model.');
                    }
                    const actualIndexes = await knex.raw('SELECT name, "unique" AS is_unique, origin, partial FROM pragma_index_list(?)', [table(path, hashed)]);
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
                    const foreignKeys = await knex.raw('SELECT id, seq, "table" AS target_table, "from" AS local_name, "to" AS target_name, on_update, on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq', [table(path, hashed)]);
                    const actualRelations = [];
                    for (const id of new Set(foreignKeys.map(key => key.id))) {
                        const group = foreignKeys.filter(key => key.id === id);
                        if (group.some(key => !['NO ACTION','RESTRICT'].includes(key.on_update) || !['NO ACTION','RESTRICT'].includes(key.on_delete)))
                            fail('UNSUPPORTED', 'Cascading relations are unsupported.');
                        actualRelations.push(JSON.stringify([group[0].target_table, group.map(key => key.local_name), group.map(key => key.target_name)]));
                    }
                    const expectedRelations = Object.values(entity.relations).map(relation => JSON.stringify([table(relation.target.path, hashed), relation.attributes, relation.target.attributes])).sort();
                    if (JSON.stringify(actualRelations.sort()) !== JSON.stringify(expectedRelations))
                        fail('UNSUPPORTED', 'Database relations do not match the effective model.');
                    }
                } catch (error) { mapError(error); }
                /**
                 * @param {any} input
                 * @returns {any}
                 */
                const key = input => toDb(entity, normalize.key({entity, key: input}).values, pg, mysql);
                /**
                 * @returns {any}
                 */
                const query = () => knex(table(path, hashed)).select(projection(entity,knex));
                /**
                 * @param {any} fn
                 * @returns {Promise<any>}
                 */
                const wrap = async fn => { try { return await fn(); } catch (e) { mapError(e); } };
                return {
                    create: async params => wrap(async () => {
                        shape(params, ['record']);
                        const logical = normalize.record({entity,record:params.record,mode:'create'});
                        for (const a of entity.attributes) if (a.type.name==='identity' && a.type.profile.type==='uuid' && a.generation && !Object.hasOwn(logical,a.name)) logical[a.name]=randomUUID();
                        const value = toDb(entity,logical,pg,mysql);
                        return knex.transaction(async trx => {
                            if (!hashed) await ensureForeignKeys(trx);
                            if (mysql) { const [rows] = await trx.raw('SELECT @@foreign_key_checks AS enabled, @@sql_mode AS mode'); if (Number(rows[0].enabled) !== 1 || !/(?:^|,)STRICT_(?:ALL|TRANS)_TABLES(?:,|$)/.test(String(rows[0].mode))) fail('UNSUPPORTED', 'MariaDB foreign keys and strict mode are required.'); }
                            const generated = entity.attributes.find(a => a.type.name === 'identity' && a.type.profile.type === 'int' && a.generation);
                            if (pg && generated) {
                                await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [table(path, hashed)]);
                                if (!Object.hasOwn(value, generated.name)) {
                                    const highest = await trx(table(path, hashed)).select(trx.raw('CAST(MAX(??) AS TEXT) AS value',[generated.name])).first();
                                    const next = BigInt(highest.value ?? '0') + 1n;
                                    if (next > 9223372036854775807n) fail('STORAGE', 'Identity capacity exhausted.');
                                    value[generated.name] = next.toString();
                                }
                            }
                            if (mysql) {
                                await trx(table(path, hashed)).insert(value);
                                if (generated && !Object.hasOwn(value, generated.name)) {
                                    const [rows]=await trx.raw('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
                                    value[generated.name]=rows[0].id;
                                }
                                return {record: fromDb(entity, value)};
                            }
                            const rows = await trx(table(path, hashed)).insert(value).returning(projection(entity,trx));
                            return {record: fromDb(entity, rows[0])};
                        });
                    }),
                    read: async params => wrap(async () => { shape(params, ['key']); return {record: fromDb(entity, await query().where(key(params.key)).first())}; }),
                    update: async params => wrap(async () => {
                        shape(params, ['key', 'changes']);
                        const values = key(params.key), changes = toDb(entity, normalize.record({entity, record:params.changes, mode:'update'}), pg, mysql);
                        return knex.transaction(async trx => {
                            if (!hashed) await ensureForeignKeys(trx);
                            if (mysql) { const [rows] = await trx.raw('SELECT @@foreign_key_checks AS enabled, @@sql_mode AS mode'); if (Number(rows[0].enabled) !== 1 || !/(?:^|,)STRICT_(?:ALL|TRANS)_TABLES(?:,|$)/.test(String(rows[0].mode))) fail('UNSUPPORTED', 'MariaDB foreign keys and strict mode are required.'); }
                            if (mysql) {
                                const before = await trx(table(path, hashed)).select(projection(entity,trx)).where(values).forUpdate().first();
                                if (!before) return {record:null};
                                await trx(table(path, hashed)).where(values).update(changes);
                                return {record:fromDb(entity, {...before,...changes})};
                            }
                            const rows = await trx(table(path, hashed)).where(values).update(changes).returning(projection(entity,trx));
                            return {record: fromDb(entity, rows[0])};
                        });
                    }),
                    delete: async params => wrap(async () => { shape(params, ['key']); const values = key(params.key); return knex.transaction(async trx => { if (!hashed) await ensureForeignKeys(trx);
                            if (mysql) { const [rows] = await trx.raw('SELECT @@foreign_key_checks AS enabled, @@sql_mode AS mode'); if (Number(rows[0].enabled) !== 1 || !/(?:^|,)STRICT_(?:ALL|TRANS)_TABLES(?:,|$)/.test(String(rows[0].mode))) fail('UNSUPPORTED', 'MariaDB foreign keys and strict mode are required.'); } return {deleted: (await trx(table(path, hashed)).where(values).delete()) > 0}; }); }),
                    list: async params => wrap(async () => {
                        shape(params, ['selection']);
                        const s = selection.create({entity, selection:params.selection});
                        if (entity.attributes.some(a=>mysql && codec.type({attribute:a,dialect:'mysql2',indexed:codec.indexed(entity,a.name)})==='longblob' || ['decimal','datetime','binary','json','vector'].includes(a.type.name) || a.type.name==='integer' && (a.type.params.bits===64 || a.type.params.unsigned && a.type.params.bits===32)))
                            return evaluate.exec({entity,records:(await query()).map(row=>fromDb(entity,row)),selection:s});
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
                            return {sql:`(?? IS NOT NULL AND ?? ${symbols[op]} ?)`, bindings:[name,name,toDb(entity,{[name]:value}, pg, mysql)[name]]};
                        };
                        let q = query();
                        if (s.where) { const p = expr(s.where); q = q.whereRaw(p.sql,p.bindings); }
                        for (const o of s.orderBy) { q = q.orderByRaw('?? IS NULL ' + (o.nulls === 'first' ? 'DESC' : 'ASC'), [table(path,hashed)+'.'+o.attribute]).orderBy(table(path,hashed)+'.'+o.attribute,o.direction); }
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
                const created = [];
                const foreign = [];
                /**
                 * @param {any} trx
                 * @returns {Promise<void>}
                 */
                const execute = async function (trx) {
                    if (!hashed) await ensureForeignKeys(trx);
                    if (mysql) { const [rows] = await trx.raw('SELECT @@foreign_key_checks AS enabled, @@sql_mode AS mode'); if (Number(rows[0].enabled) !== 1 || !/(?:^|,)STRICT_(?:ALL|TRANS)_TABLES(?:,|$)/.test(String(rows[0].mode))) fail('UNSUPPORTED', 'MariaDB foreign keys and strict mode are required.'); }
                    for (const path of Object.keys(model.entities)) if (await trx.schema.hasTable(table(path, hashed))) fail('CONFLICT', 'Target table already exists.');
                    for (const [path,entity] of Object.entries(model.entities)) {
                        await trx.schema.createTable(table(path, hashed), t => {
                            if (mysql) t.engine('InnoDB');
                            for (const a of entity.attributes) {
                                let c;
                                if (a.type.name === 'identity' && a.type.profile.type === 'int' && a.generation) { if (pg) t.bigInteger(a.name).primary(); else if (mysql) t.specificType(a.name, 'bigint unsigned NOT NULL AUTO_INCREMENT').primary(); else t.increments(a.name); continue; }
                                const physical = codec.type({attribute:a,dialect:knex.client.config.client,indexed:codec.indexed(entity,a.name)});
                                c = t.specificType(a.name,pg && physical==='text' ? 'text COLLATE "C"' : physical);
                                if (!a.nullable) c.notNullable();
                            }
                            if (entity.primaryKey && !entity.attributes.some(a => a.type.name === 'identity' && a.type.profile.type === 'int' && a.generation)) t.primary(entity.primaryKey);
                            for (const [name, columns] of Object.entries(entity.uniqueKeys)) t.unique(columns, hashed ? `${table(path, hashed)}_u_${createHash('sha256').update(name).digest('hex').slice(0, 16)}` : `${table(path, hashed)}_u_${name}`);
                            for (const [name, columns] of Object.entries(entity.indexes)) t.index(columns.attributes, hashed ? `${table(path, hashed)}_i_${createHash('sha256').update(name).digest('hex').slice(0, 16)}` : `${table(path, hashed)}_i_${name}`);
                            if (!hashed) for (const [index, relation] of Object.values(entity.relations).entries()) t.foreign(relation.attributes, `${table(path, hashed)}_f_${index}`).references(relation.target.attributes).inTable(table(relation.target.path, hashed));
                        });
                        created.push(path);
                    }
                    if (hashed) for (const [path, entity] of Object.entries(model.entities)) {
                        for (const [index, relation] of Object.values(entity.relations).entries()) {
                            const name = `${table(path, hashed)}_f_${index}`;
                            await trx.schema.alterTable(table(path, hashed), t => t.foreign(relation.attributes, name).references(relation.target.attributes).inTable(table(relation.target.path, hashed)));
                            foreign.push({path,name,attributes:relation.attributes});
                        }
                    }
                };
                try {
                    if (mysql) await execute(knex); else await knex.transaction(execute);
                } catch (error) {
                    if (mysql) {
                        try {
                            for (const relation of foreign.reverse()) await knex.schema.alterTable(table(relation.path, true), t=>t.dropForeign(relation.attributes, relation.name));
                            for (const path of created.reverse()) await knex.schema.dropTableIfExists(table(path, true));
                        } catch { fail('STORAGE', 'Schema creation failed and cleanup was incomplete.'); }
                    }
                    mapError(error);
                }
            };
            return {get, createSchema};
        };
    }
}
export const __deps__ = Object.freeze({default:Object.freeze({normalize:'TeqFw_Dem_Repository_Normalize$', selection:'TeqFw_Dem_Dto_Query_Selection__Factory$', errors:'TeqFw_Dem_Repository_Error$',createHash:'node:crypto__createHash',randomUUID:'node:crypto__randomUUID',codec:'TeqFw_DemRdb_Codec$',evaluate:'TeqFw_Dem_Repository_Select$'})});
