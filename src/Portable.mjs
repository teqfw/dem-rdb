// @ts-check
/**
 * @namespace TeqFw_DemRdb_Portable
 * @description Software realization of DEM on relational columns with schema history and atomic batches.
 */
export default class Portable {
    /**
     * @param {object} deps
     * @param {any} deps.codec
     * @param {any} deps.batch
     * @param {any} deps.normalize
     * @param {any} deps.errors
     * @param {typeof import('node:crypto').createHash} deps.createHash
     * @param {typeof import('node:crypto').randomUUID} deps.randomUUID
     */
    constructor({codec,batch,normalize,errors,createHash,randomUUID}) {
        /** @param {string} code @param {string} message @returns {any} */
        const fail=function (code,message) {throw errors.create({code,message});};
        /** @param {any} error @returns {any} */
        const mapped=function (error) {return error?.name==='DemRepositoryError' ? error : errors.create({code:'STORAGE',message:'Portable SQL operation failed.'});};
        /** @param {any} value @returns {string} */
        const canonical=function (value) {return JSON.stringify(value,(_k,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);};
        /** @param {any} value @returns {any} */
        const json=function (value) {return Buffer.from(canonical(value),'utf8');};
        /** @param {any} value @returns {any} */
        const parsed=function (value) {return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);};
        /** @param {any} params @param {Array<string>} keys @returns {void} */
        const shape=function (params,keys) {if (!params || typeof params!=='object' || Array.isArray(params) || Object.keys(params).length!==keys.length || keys.some(k=>!Object.hasOwn(params,k))) fail('INVALID_INPUT','Invalid portable SQL parameters.');};
        /**
         * @param {object} deps
         * @param {any} deps.model
         * @param {any} deps.knex
         * @param {string} [deps.name]
         * @param {boolean} [deps.enforceRelations]
         * @returns {Promise<any>}
         */
        this.open=async function ({model,knex,name='default',enforceRelations=true}) {
            const dialect=knex?.client?.config?.client;
            if (!model?.entities || typeof knex!=='function' || !['sqlite3','pg','mysql2'].includes(dialect) || typeof name!=='string' || !name || typeof enforceRelations!=='boolean') fail('INVALID_INPUT','A model, supported Knex connection and storage name are required.');
            if (dialect==='sqlite3' && knex.client.config.pool?.max!==1) fail('UNSUPPORTED','SQLite requires a single connection pool.');
            const snapshot=JSON.parse(JSON.stringify(model)),identity=canonical(snapshot),paths=Object.keys(snapshot.entities);
            /** @param {string} value @returns {string} */
            const hash=value=>createHash('sha256').update(value).digest('hex');
            const prefix='dem_p_'+hash(name).slice(0,12),meta=prefix+'_state',history=prefix+'_history';
            /** @param {string} path @returns {string} */
            const table=path=>prefix+'_'+hash(path).slice(0,24);
            /** @param {string} attribute @returns {string} */
            const column=attribute=>'a_'+hash(attribute).slice(0,32);
            const bytes=dialect==='pg' ? 'bytea' : dialect==='mysql2' ? 'longblob' : 'blob';
            let closed=false,boundVersion;
            const physicalNames=new Set();
            for (const path of paths) {
                if (physicalNames.has(table(path))) fail('UNSUPPORTED','Physical entity name collision.');physicalNames.add(table(path));
                const names=new Set();
                for (const a of snapshot.entities[path].attributes) {
                    if (names.has(column(a.name))) fail('UNSUPPORTED','Physical attribute name collision.');names.add(column(a.name));
                    if (!['identity','ref','integer','decimal','boolean','string','text','uuid','enum','date','datetime','binary','json','vector'].includes(a.type.name)) fail('UNSUPPORTED','Unsupported logical type.');
                    if (a.generation && a.type.name!=='identity') fail('UNSUPPORTED','Only identity generation is supported.');
                }
            }
            /** @returns {void} */
            const live=function () {if (closed) fail('STORAGE','Provider is closed.');};
            /** @param {any} connection @param {Array<string>} names @returns {Promise<void>} */
            const engine=async function (connection,names) {
                if (dialect!=='mysql2') return;
                const [mode]=await connection.raw('SELECT @@sql_mode AS mode');
                if (!/(?:^|,)STRICT_(?:ALL|TRANS)_TABLES(?:,|$)/.test(String(mode[0].mode))) fail('UNSUPPORTED','Portable MariaDB requires strict SQL mode.');
                if (!names.length) return;
                const [tables]=await connection.raw('SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+names.map(()=>'?').join(',')+')',names);
                if (tables.length!==names.length || tables.some(t=>t.engine!=='InnoDB')) fail('UNSUPPORTED','Portable metadata and entity stores require InnoDB.');
            };
            /** @param {any} connection @param {string} physical @returns {Promise<any>} */
            const columns=async function (connection,physical) {
                if (dialect==='sqlite3') return (await connection.raw('SELECT name,type FROM pragma_table_info(?)',[physical])).map(c=>({name:c.name,type:c.type.toLowerCase()}));
                if (dialect==='pg') return (await connection.raw(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=? AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`,[physical])).rows;
                const [rows]=await connection.raw('SELECT COLUMN_NAME AS name,DATA_TYPE AS type,COLUMN_TYPE AS detail,NUMERIC_PRECISION AS precision_value,NUMERIC_SCALE AS scale_value FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[physical]);
                return rows.map(c=>({name:c.name,type:c.type==='int' ? 'integer' : c.type==='decimal' ? `decimal(${c.precision_value},${c.scale_value})` : c.type==='bigint' && c.detail.includes('unsigned') ? 'bigint unsigned' : c.type}));
            };
            /** @param {any} attribute @returns {string} */
            const storageType=function (attribute) {return codec.type({attribute,dialect,indexed:false,portable:true});};
            /** @param {any} connection @param {string} path @returns {Promise<any>} */
            const verify=async function (connection,path) {
                const info=await columns(connection,table(path));
                if (!info.some(c=>c.name==='_dem_row') || !info.some(c=>c.name==='_dem_fields' && c.type===bytes)) fail('UNSUPPORTED','Portable entity layout is incompatible.');
                for (const a of snapshot.entities[path].attributes) if (!info.some(c=>c.name===column(a.name) && c.type===storageType(a))) fail('UNSUPPORTED','Portable attribute type is incompatible; migrate values explicitly.');
                return info;
            };
            /** @param {any} connection @param {boolean} [lock] @returns {Promise<any>} */
            const current=async function (connection,lock=false) {
                if (!await connection.schema.hasTable(meta)) fail('UNSUPPORTED','Initialize portable schema explicitly.');
                await engine(connection,[meta,...paths.map(table)]);
                let query=connection(meta).where({id:'current'});
                if (lock && dialect!=='sqlite3') query=query.forUpdate();
                const row=await query.first();
                if (!row || Number(row.layout)!==1 || parsed(row.scope)!==name) fail('UNSUPPORTED','Portable schema metadata is incompatible.');
                if (boundVersion!==undefined && boundVersion!==Number(row.version)) {closed=true;fail('STORAGE','Provider was invalidated by a schema update.');}
                if (canonical(parsed(row.model))!==identity) fail('UNSUPPORTED','The configured model differs from storage; update schema or reconfigure the provider.');
                boundVersion=Number(row.version);
                return row;
            };
            /** @param {any} connection @param {string} path @returns {any} */
            const projection=function (connection,path) {
                return ['_dem_row','_dem_fields',...snapshot.entities[path].attributes.map(a=>codec.numeric(a) || a.type.name==='decimal' && !['text','longblob'].includes(storageType(a))
                    ? connection.raw('CAST(?? AS '+(dialect==='mysql2' ? 'CHAR' : 'TEXT')+') AS ??',[column(a.name),column(a.name)]) : column(a.name))];
            };
            /** @param {string} path @param {any} row @returns {any} */
            const logical=function (path,row) {
                try {
                    const entity=snapshot.entities[path],fields=parsed(row._dem_fields);
                    if (!Array.isArray(fields) || fields.some(name=>typeof name!=='string')) throw new Error('Invalid field inventory');
                    const present=entity.attributes.filter(a=>fields.includes(a.name));
                    const partial={...entity,attributes:present};
                    const stored=Object.fromEntries(present.map(a=>[a.name,row[column(a.name)]]));
                    const record=codec.decode(partial,stored,true);
                    return normalize.record({entity,record:normalize.record({entity,record,mode:'create'}),mode:'complete'});
                } catch (error) {throw errors.create({code:'STORAGE',message:'Stored values require explicit migration to the selected model.'});}
            };
            /** @param {string} path @param {any} record @returns {any} */
            const encode=function (path,record) {
                const entity=snapshot.entities[path],values=codec.encode({entity,record,dialect,portable:true});
                return {...Object.fromEntries(Object.entries(values).map(([name,value])=>[column(name),value])),_dem_fields:json(Object.keys(record))};
            };
            /** @param {any} params @returns {Promise<any>} */
            const execute=async function (params) {
                live();shape(params,['operations']);
                const commands=batch.validate({model:snapshot,operations:params.operations}),write=commands.some(c=>['create','update','delete'].includes(c.method));
                try {
                    return await knex.transaction(async trx=>{
                        const state=await current(trx,true),sequences=parsed(state.sequences),rows=Object.create(null),before=Object.create(null);
                        for (const path of paths) {
                            rows[path]=(await trx(table(path)).select(projection(trx,path))).map(row=>({key:row._dem_row,record:logical(path,row)}));
                            before[path]=new Map(rows[path].map(row=>[row.key,row.record]));
                        }
                        const result=batch.plan({model:snapshot,operations:commands,rows,enforceRelations,
                            generate:({path,attribute,rows})=>{
                                if (attribute.type.profile.type==='uuid') return randomUUID();
                                let value=BigInt(sequences[path] ?? '0');
                                for (const row of rows) if (BigInt(row.record[attribute.name])>value) value=BigInt(row.record[attribute.name]);
                                return (value+1n).toString();
                            },
                            created:({path,entity,record})=>{
                                const a=entity.attributes.find(a=>a.type.name==='identity' && a.type.profile.type==='int');
                                if (a && BigInt(record[a.name])>BigInt(sequences[path] ?? '0')) sequences[path]=record[a.name];
                            },
                        });
                        if (write) {
                            for (const path of paths) {
                                const keys=new Set(rows[path].filter(row=>row.key!==undefined).map(row=>row.key));
                                for (const key of before[path].keys()) if (!keys.has(key)) await trx(table(path)).where({_dem_row:key}).delete();
                                for (const row of rows[path]) {
                                    if (row.key===undefined) await trx(table(path)).insert({_dem_row:randomUUID(),...encode(path,row.record)});
                                    else if (canonical(before[path].get(row.key))!==canonical(row.record)) await trx(table(path)).where({_dem_row:row.key}).update(encode(path,row.record));
                                }
                            }
                            await trx(meta).where({id:'current'}).update({sequences:json(sequences)});
                        }
                        return result;
                    });
                } catch (error) {throw mapped(error);}
            };
            /** @param {any} params @returns {Promise<any>} */
            const get=async function (params) {
                live();shape(params,['path']);
                const path=params.path;
                if (typeof path!=='string' || !/^\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(path)) fail('INVALID_INPUT','Expected a canonical entity path.');
                if (!snapshot.entities[path]) fail('NOT_FOUND','Entity not found.');
                try {await current(knex);await verify(knex,path);} catch(error) {throw mapped(error);}
                return Object.fromEntries(['create','read','update','delete','list'].map(method=>[method,async params=>(await execute({operations:[{path,method,params}]})).results[0]]));
            };
            /** @returns {Promise<any>} */
            const createSchema=async function () {
                live();
                const createdTables=[],addedColumns=[];
                let previous;
                /** @param {any} connection @returns {Promise<void>} */
                const prepare=async function (connection) {
                    await engine(connection,[]);
                    const hasMeta=await connection.schema.hasTable(meta),hasHistory=await connection.schema.hasTable(history);
                    if (hasMeta!==hasHistory) fail('UNSUPPORTED','Incomplete metadata tables require host repair.');
                    if (hasMeta) {
                        const info=await columns(connection,meta);
                        if (!['id','scope','version','layout','model','sequences'].every(name=>info.some(c=>c.name===name))) fail('UNSUPPORTED','Unknown metadata layout.');
                        previous=await connection(meta).where({id:'current'}).first();
                        if (!previous || Number(previous.layout)!==1 || parsed(previous.scope)!==name) fail('UNSUPPORTED','Unknown metadata revision.');
                    } else {
                        for (const path of paths) if (await connection.schema.hasTable(table(path))) fail('CONFLICT','Unowned target table already exists.');
                        await connection.schema.createTable(meta,t=>{if(dialect==='mysql2')t.engine('InnoDB');t.string('id',16).primary();t.specificType('scope',bytes).notNullable();t.integer('version').notNullable();t.integer('layout').notNullable();t.specificType('model',bytes).notNullable();t.specificType('sequences',bytes).notNullable();});createdTables.push(meta);
                        await connection.schema.createTable(history,t=>{if(dialect==='mysql2')t.engine('InnoDB');t.integer('version').primary();t.integer('layout').notNullable();t.specificType('model',bytes).notNullable();});createdTables.push(history);
                    }
                    if (hasMeta) await engine(connection,[meta,history]);
                    const models=hasMeta ? (await connection(history).select('model')).map(row=>parsed(row.model)) : [];
                    for (const path of paths) {
                        const exists=await connection.schema.hasTable(table(path));
                        if (!exists) {
                            await connection.schema.createTable(table(path),t=>{
                                if(dialect==='mysql2')t.engine('InnoDB');t.string('_dem_row',36).primary();t.specificType('_dem_fields',bytes).notNullable();
                                for(const a of snapshot.entities[path].attributes)t.specificType(column(a.name),storageType(a));
                            });createdTables.push(table(path));
                        } else {
                            if (!models.some(m=>m.entities[path])) fail('UNSUPPORTED','Existing entity store has no owned schema history.');
                            const info=await columns(connection,table(path));
                            if (!info.some(c=>c.name==='_dem_row') || !info.some(c=>c.name==='_dem_fields' && c.type===bytes)) fail('UNSUPPORTED','Existing entity layout is incompatible.');
                            for (const a of snapshot.entities[path].attributes) {
                                const found=info.find(c=>c.name===column(a.name));
                                if (found && found.type!==storageType(a)) fail('UNSUPPORTED','Physical type change requires explicit migration.');
                                for (const old of models.flatMap(m=>m.entities[path]?.attributes ?? [])) if (old.name!==a.name && column(old.name)===column(a.name)) fail('UNSUPPORTED','Physical attribute name collision.');
                                if (!found) {await connection.schema.alterTable(table(path),t=>t.specificType(column(a.name),storageType(a)));addedColumns.push({table:table(path),column:column(a.name)});}
                            }
                        }
                    }
                };
                /** @param {any} connection @returns {Promise<any>} */
                const publish=async function (connection) {
                    if (previous && canonical(parsed(previous.model))===identity) return {version:Number(previous.version)};
                    const version=Number(previous?.version ?? 0)+1;
                    if (version>2147483647) fail('STORAGE','Schema version capacity exhausted.');
                    await connection(history).insert({version,layout:1,model:json(snapshot)});
                    const row={id:'current',scope:json(name),version,layout:1,model:json(snapshot),sequences:previous?.sequences ?? json({})};
                    if (previous) await connection(meta).where({id:'current'}).update(row);else await connection(meta).insert(row);
                    return {version};
                };
                try {
                    let result;
                    if (dialect==='mysql2') {await prepare(knex);result=await knex.transaction(publish);}
                    else result=await knex.transaction(async trx=>{await prepare(trx);return publish(trx);});
                    boundVersion=result.version;return result;
                } catch(error) {
                    if (dialect==='mysql2') try {
                        for(const item of addedColumns.reverse())await knex.schema.alterTable(item.table,t=>t.dropColumn(item.column));
                        for(const name of createdTables.reverse())await knex.schema.dropTableIfExists(name);
                    } catch {fail('STORAGE','Schema update failed and cleanup was incomplete.');}
                    throw mapped(error);
                }
            };
            /** @returns {Promise<any>} */
            const getSchemaHistory=async function () {live();try {await current(knex);return {schemas:(await knex(history).orderBy('version')).map(row=>({version:Number(row.version),model:parsed(row.model)}))};} catch(error) {throw mapped(error);}};
            return {get,execute,createSchema,getSchemaHistory,close:async function () {closed=true;}};
        };
    }
}
export const __deps__=Object.freeze({default:Object.freeze({codec:'TeqFw_DemRdb_Codec$',batch:'TeqFw_Dem_Repository_Batch$',normalize:'TeqFw_Dem_Repository_Normalize$',errors:'TeqFw_Dem_Repository_Error$',createHash:'node:crypto__createHash',randomUUID:'node:crypto__randomUUID'})});
