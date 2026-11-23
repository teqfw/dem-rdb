// @ts-check
/**
 * @namespace TeqFw_Dem_RDb_Codec
 * @description Reversible core DEM values and dialect-specific physical column types.
 */
export default class Codec {
    /**
     * @param {object} deps
     * @param {any} deps.normalize
     * @param {any} deps.errors
     */
    constructor({normalize,errors}) {
        /** @param {any} a @returns {boolean} */
        const numeric = function (a) { return a.type.name === 'integer' || ['identity','ref'].includes(a.type.name) && a.type.profile?.type === 'int'; };
        /** @param {any} a @returns {boolean} */
        this.numeric = function (a) { return numeric(a); };
        /** @param {TeqFw_Dem_RDb_Codec_Entity} entity @param {string} name @returns {boolean} */
        this.indexed = function (entity,name) {
            return [entity.primaryKey,...Object.values(entity.uniqueKeys),...Object.values(entity.indexes).map(index=>index.attributes),...Object.values(entity.relations).map(relation=>relation.attributes)].some(members=>members?.includes(name));
        };
        /**
         * @param {object} deps
         * @param {any} deps.attribute
         * @param {string} deps.dialect
         * @param {boolean} deps.indexed
         * @returns {string}
         */
        this.type = function ({attribute:a,dialect,indexed}) {
            const n=a.type.name,p=a.type.params ?? {};
            if (n==='teqfw.dem_rdb.vector') {
                if (dialect==='pg' && Number.isSafeInteger(p.dimensions) && p.dimensions>0 && p.dimensions<=2000)
                    return 'vector(' + p.dimensions + ')';
                if (dialect==='sqlite3' && Number.isSafeInteger(p.dimensions) && p.dimensions>0) return 'text';
                throw errors.create({code:'UNSUPPORTED',message:'The selected relational engine cannot represent the declared DEM vector.'});
            }
            if (n==='boolean') return 'integer';
            if (numeric(a)) {
                if (n !== 'integer') return dialect==='pg' ? 'bigint' : dialect==='mysql2' ? 'bigint unsigned' : 'integer';
                if (p.bits < 32 || p.bits === 32 && !p.unsigned) return 'integer';
                if (dialect==='sqlite3') return 'text';
                if (dialect==='pg') return p.bits===64 && p.unsigned ? 'numeric(20,0)' : 'bigint';
                return p.unsigned ? 'bigint unsigned' : 'bigint';
            }
            if (n==='decimal') {
                if (dialect==='pg' && p.precision<=1000) return `numeric(${p.precision},${p.scale})`;
                if (dialect==='mysql2' && p.precision<=65 && p.scale<=38) return `decimal(${p.precision},${p.scale})`;
            }
            if (n==='binary') return dialect==='pg' ? 'bytea' : dialect==='mysql2' ? indexed ? 'varbinary(512)' : 'longblob' : 'blob';
            if (dialect==='mysql2') return indexed ? 'varbinary(512)' : 'longblob';
            return 'text';
        };
        /**
         * @param {object} deps
         * @param {TeqFw_Dem_RDb_Codec_Entity} deps.entity
         * @param {TeqFw_Dem_Record} deps.record
         * @param {string} deps.dialect
         * @returns {any}
         */
        this.encode = function ({entity,record,dialect}) {
            return Object.fromEntries(Object.entries(record).map(([key,value])=>{
                const a=/** @type {TeqFw_Dem_RDb_Codec_Attribute} */ (entity.attributes.find(a=>a.name===key)), n=a.type.name;
                if (value===null) return [key,null];
                const vector=n==='teqfw.dem_rdb.vector';
                const type=this.type({attribute:a,dialect,indexed:this.indexed(entity,key)});
                if (['identity','ref'].includes(n) && (/** @type {any} */ (a.type.profile)).type==='int') {
                    const max=dialect==='mysql2' ? 18446744073709551615n : 9223372036854775807n;
                    if (BigInt(/** @type {any} */ (value))>max) throw errors.create({code:'UNSUPPORTED',message:'Identity exceeds native 64-bit storage capacity.'});
                    return [key,String(value)];
                }
                if (numeric(a) && type==='integer') {
                    const number=Number(value);
                    if (!Number.isSafeInteger(number) || dialect!=='sqlite3' && (number < -2147483648 || number > 2147483647)) throw errors.create({code:'UNSUPPORTED',message:'Value exceeds physical integer capacity.'});
                    return [key,number];
                }
                if (n==='boolean') return [key,Number(value)];
                if (typeof value==='string' && ['string','text','enum','uuid','date','datetime','identity','ref'].includes(n) && (Buffer.from(value,'utf8').toString('utf8')!==value || dialect==='pg' && value.includes('\0')))
                    throw errors.create({code:'UNSUPPORTED',message:'Text cannot be represented losslessly in the selected physical encoding.'});
                if (n==='binary') value=Buffer.from(String(value),'base64');
                else if (vector && dialect==='pg') {
                    if (!Array.isArray(value) || value.length!==(/** @type {any} */ (a.type.params)).dimensions || value.some(component=>!Number.isFinite(component) || !Number.isFinite(Math.fround(component))))
                        throw errors.create({code:'UNSUPPORTED',message:'Vector values exceed pgvector float32 capacity or have an invalid dimension.'});
                    value='['+value.map(component=>{
                        const stored=Math.fround(component);
                        return Object.is(stored,-0)?'-0':String(stored);
                    }).join(',')+']';
                } else if (vector && dialect==='sqlite3') {
                    value='['+(/** @type {any} */ (value)).map((/** @type {number} */ component)=>Object.is(component,-0)?'-0':String(component)).join(',')+']';
                } else if (n==='json') value=JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])) : item);
                if (dialect==='mysql2' && ['longblob','varbinary(512)'].includes(type) && !Buffer.isBuffer(value)) value=Buffer.from(String(value),'utf8');
                if (type==='varbinary(512)' && Buffer.byteLength(/** @type {any} */ (value))>512) throw errors.create({code:'UNSUPPORTED',message:'Indexed MariaDB value exceeds 512 bytes.'});
                return [key,value];
            }));
        };
        /** @param {TeqFw_Dem_RDb_Codec_Entity} entity @param {any} row @param {any} [normalizer] @param {string} [dialect] @returns {any} */
        this.decode = function (entity,row,normalizer=normalize,dialect='sqlite3') {
            if (!row) return null;
            try {
                const result=Object.fromEntries(entity.attributes.map(a=>{
                    let value=row[a.name];
                    if (value===null) return [a.name,null];
                    if (a.type.name==='binary') {
                        if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new Error('Invalid binary driver result');
                        return [a.name,Buffer.from(value).toString('base64')];
                    }
                    if (Buffer.isBuffer(value)) {
                        const decoded=value.toString('utf8');
                        if (!Buffer.from(decoded,'utf8').equals(value)) throw new Error('Invalid UTF8');
                        value=decoded;
                    }
                    if (numeric(a)) {
                        if (typeof value==='number' && !Number.isSafeInteger(value)) throw new Error('Unsafe numeric driver result');
                        value=String(value);
                    }
                    if (a.type.name==='decimal' && typeof value!=='string') throw new Error('Exact decimals require string driver results');
                    if (a.type.name==='boolean') { if (![0,1,false,true].includes(value)) throw new Error('Invalid boolean'); value=Boolean(value); }
                    if (a.type.name==='teqfw.dem_rdb.vector') {
                        const parsed=typeof value==='string' ? JSON.parse(value) : value;
                        if (!Array.isArray(parsed)) throw new Error('Invalid PostgreSQL vector result');
                        value=parsed.map(component=>{
                            const number=Number(component);
                            return dialect==='pg' ? Math.fround(number) : number;
                        });
                    } else if (a.type.name==='json') value=JSON.parse(value);
                    return [a.name,value];
                }));
                return normalizer.record({entity,record:result,mode:'complete'});
            } catch { throw errors.create({code:'STORAGE',message:'Stored record or driver conversion is incompatible with its logical type.'}); }
        };
    }
}
export const __deps__=Object.freeze({default:Object.freeze({normalize:'TeqFw_Dem_Repository_Normalize$',errors:'TeqFw_Dem_Repository_Error$'})});
