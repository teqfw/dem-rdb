import {createHash,randomBytes} from 'node:crypto';
import Container from '@teqfw/di';
import {resolve} from 'node:path';
import knex from 'knex';
import Connection from '../../src/Connection.mjs';

export const connection=client=>{
    const prefix=client==='pg' ? 'TEQFW_DB__PG_' : 'TEQFW_DB__MYSQL_';
    return {host:process.env[prefix+'HOST'],user:process.env[prefix+'USER'],password:process.env[prefix+'PASSWORD'],database:process.env[prefix+'DATABASE']};
};
export const enabled=client=>client==='sqlite3' || Object.values(connection(client)).every(Boolean);
export async function harness(client,{definitions=[]}={}) {
    const name='portable_'+randomBytes(8).toString('hex'),prefix='dem_p_'+createHash('sha256').update(name).digest('hex').slice(0,12);
    const schema='dem_portable_'+randomBytes(8).toString('hex');
    const dbConfig={client,connection:client==='sqlite3' ? {filename:':memory:'} : connection(client),searchPath:client==='pg' ? [schema] : undefined,useNullAsDefault:true,pool:{min:0,max:client==='sqlite3' ? 1 : 4}};
    const ownedConnection=new Connection({knexFactory:knex});
    await ownedConnection.init(dbConfig);
    const db=ownedConnection.getClient();
    const c=new Container();
    c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
    c.addNamespaceRoot('TeqFw_Dem_RDb_',process.env.TEQFW_DEM_RDB_ROOT ? resolve(process.env.TEQFW_DEM_RDB_ROOT,'src') : new URL('../../src',import.meta.url).pathname,'.mjs');
    const providers=[];
    let owned=false;
    try {
        if (client==='pg') {await db.raw('CREATE SCHEMA ??',[schema]);owned=true;}
        if (client==='mysql2') {
            const [rows]=await db.raw('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,?)=?',[prefix.length,prefix]);
            if(rows.length)throw new Error('Portable test scope already exists; refusing to modify it.');owned=true;
        }
        const registry=await c.get('TeqFw_Dem_Registry$');
        if(definitions.length)registry.register(definitions);
        registry.finalize();
        const compiler=await c.get('TeqFw_Dem_Compile$'),adapter=await c.get('TeqFw_Dem_RDb_Adapter$'),selection=await c.get('TeqFw_Dem_Dto_Query_Selection__Factory$');
        const runtime=await c.get('TeqFw_Dem_Repository_Runtime$');
        const close=async()=>{
            try {
                for(const provider of providers)await provider.close();
                if(owned && client==='pg')await db.raw('DROP SCHEMA ?? CASCADE',[schema]);
                if(owned && client==='mysql2') {
                    const [rows]=await db.raw('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,?)=?',[prefix.length,prefix]);
                    for(const row of rows)await db.schema.dropTable(row.name);
                }
            } finally {await ownedConnection.disconnect();}
        };
        const open=async({schema:document,map,enforceRelations=true,runtime:useRuntime=false,handlers,name:storageName=name})=>{
            const {model}=await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
            const binding=useRuntime ? runtime.bind({model,registry,...(handlers ? {handlers} : {})}) : undefined;
            const provider=await adapter.open({model,connection:ownedConnection,projection:'portable',name:storageName,enforceRelations,...(binding ? {runtime:binding} : {})});providers.push(provider);
            return {provider,model,selection,close};
        };
        const compile=async({schema:document,map})=> (await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})})).model;
        const bind=(model,handlers)=>runtime.bind({model,registry,...(handlers ? {handlers} : {})});
        const attach=async({model,runtime:binding,name:storageName=name,enforceRelations=true})=>{const provider=await adapter.open({model,connection:ownedConnection,projection:'portable',name:storageName,enforceRelations,...(binding ? {runtime:binding} : {})});providers.push(provider);return provider;};
        return {open,compile,bind,attach,close,db,connection:ownedConnection,name,prefix};
    } catch(error) {
        try {if(owned && client==='pg')await db.raw('DROP SCHEMA ?? CASCADE',[schema]);} finally {await ownedConnection.disconnect();}throw error;
    }
}
