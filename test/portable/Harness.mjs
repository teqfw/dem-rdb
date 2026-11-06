import {randomBytes} from 'node:crypto';
import Container from '@teqfw/di';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import knex from 'knex';
import Connection from '../../src/Connection.mjs';

const configContainer=new Container();
configContainer.addNamespaceRoot('TeqFw_Cfg_',new URL('../src',import.meta.resolve('@teqfw/cfg/src/Reader.mjs')).pathname,'.mjs');
const loader=await configContainer.get('TeqFw_Cfg_Loader$');
const processEnv=await configContainer.get('TeqFw_Cfg_Source_ProcessEnv$');
const sources=[];
if(existsSync('.env')) {
    const dotenv=await configContainer.get('TeqFw_Cfg_Source_DotenvFile$');
    sources.push(dotenv.create({path:'.env'}));
}
sources.push(processEnv.create(process.env));
await loader.load(sources);
const reader=await configContainer.get('TeqFw_Cfg_Reader$');
const dbValues=reader.get('TEQFW_DB');
export const portableClient=reader.get('TEQFW_PORTABLE').CLIENT;
export const connection=client=>{
    const prefix=client==='pg' ? 'PG_' : 'MYSQL_';
    return {host:dbValues[prefix+'HOST'],user:dbValues[prefix+'USER'],password:dbValues[prefix+'PASSWORD'],database:dbValues[prefix+'DATABASE'],...(dbValues[prefix+'PORT'] ? {port:Number(dbValues[prefix+'PORT'])} : {})};
};
export const enabled=client=>client==='sqlite3' || Object.values(connection(client)).every(Boolean);
export async function harness(client,{definitions=[]}={}) {
    const name='portable_'+randomBytes(8).toString('hex'),prefix='_dem_'+name;
    const schema='dem_portable_'+randomBytes(8).toString('hex');
    const dbConfig={client,connection:client==='sqlite3' ? {filename:':memory:'} : connection(client),searchPath:client==='pg' ? [schema] : undefined,useNullAsDefault:true,pool:{min:0,max:client==='sqlite3' ? 1 : 4}};
    let ownedConnection=new Connection({knexFactory:knex});
    await ownedConnection.init(dbConfig);
    let db=ownedConnection.getClient();
    const c=new Container();
    c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
    c.addNamespaceRoot('TeqFw_Dem_RDb_',process.env.TEQFW_DEM_RDB_ROOT ? resolve(process.env.TEQFW_DEM_RDB_ROOT,'src') : new URL('../../src',import.meta.url).pathname,'.mjs');
    /** @type {any[]} */
    const providers=[];
    let owned=false;
    const ownedTables=new Set([prefix+'_state',prefix+'_history']);
    try {
        if (client==='pg') {
            await db.raw('CREATE SCHEMA ??',[schema]);
            owned=true;
            const result=await db.raw('SELECT current_schema() AS name');
            if(result.rows[0].name!==schema)throw new Error('Portable test schema is not the active schema.');
        }
        if (client==='mysql2') {
            const [rows]=await db.raw('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
            if(rows.length)throw new Error('MariaDB portable tests require an empty dedicated database.');owned=true;
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
                    for(const table of ownedTables)await db.schema.dropTableIfExists(table);
                }
            } finally {await ownedConnection.disconnect();}
        };
        const open=async({schema:document,map,enforceRelations=true,runtime:useRuntime=false,handlers,name:storageName=name})=>{
            const {model}=await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
            if (client==='mysql2') for (const path of Object.keys(model.entities)) ownedTables.add(path.slice(1).replaceAll('/','_'));
            const binding=useRuntime ? runtime.bind({model,registry,...(handlers ? {handlers} : {})}) : undefined;
            const provider=await adapter.open({model,connection:ownedConnection,projection:'portable',name:storageName,enforceRelations,...(binding ? {runtime:binding} : {})});providers.push(provider);
            return {provider,model,selection,close};
        };
        const compile=async({schema:document,map})=> (await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})})).model;
        const bind=(model,handlers)=>runtime.bind({model,registry,...(handlers ? {handlers} : {})});
        const attach=async({model,runtime:binding,name:storageName=name,enforceRelations=true})=>{const provider=await adapter.open({model,connection:ownedConnection,projection:'portable',name:storageName,enforceRelations,...(binding ? {runtime:binding} : {})});providers.push(provider);return provider;};
        const reconnect=async()=>{
            for(const provider of providers)await provider.close();
            providers.length=0;
            await ownedConnection.disconnect();
            ownedConnection=new Connection({knexFactory:knex});
            await ownedConnection.init(dbConfig);
            db=ownedConnection.getClient();
        };
        return {open,compile,bind,attach,close,reconnect,get db(){return db;},get connection(){return ownedConnection;},name,prefix};
    } catch(error) {
        try {if(owned && client==='pg')await db.raw('DROP SCHEMA ?? CASCADE',[schema]);} finally {await ownedConnection.disconnect();}throw error;
    }
}
