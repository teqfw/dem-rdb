import {test} from 'node:test';
import assert from 'node:assert/strict';
import Config from '../../src/Config.mjs';

test('configuration normalizes names, overlays explicit fields and caches frozen values',()=>{
    const values={CLIENT:'sqlite3',FILENAME:'default.sqlite',USE_NULL_AS_DEFAULT:'yes',EXTRA:{connection:{filename:'extra.sqlite'},pool:{min:1,max:1}},MAIN_DB_CLIENT:'pg',MAIN_DB_HOST:'db.local',MAIN_DB_PORT:'5432',MAIN_DB_SEARCH_PATH:'app, shared',MAIN_DB_EXTRA:{connection:{host:'wrong',port:123,user:'extra'},pool:{max:3}}};
    let reads=0;
    const config=new Config({reader:{get:name=>{assert.equal(name,'TEQFW_DEM_RDB');reads++;return values;}}});
    const main=config.get('MAIN-db');
    assert.equal(main.client,'pg');
    assert.deepEqual(main.connection,{user:'extra',host:'db.local',port:5432});
    assert.deepEqual(main.searchPath,['app','shared']);
    assert.deepEqual(main.pool,{max:3});
    assert.equal(config.get('main_db'),main);
    const fallback=config.get();
    assert.deepEqual(fallback.connection,{filename:'default.sqlite'});
    assert.equal(fallback.useNullAsDefault,true);
    assert.deepEqual(fallback.pool,{min:1,max:1});
    assert.notEqual(main,fallback);
    assert.equal(reads,2);
    assert.ok(Object.isFrozen(main) && Object.isFrozen(main.connection) && Object.isFrozen(main.pool));
});

test('configuration rejects invalid names and typed values',()=>{
    const config=new Config({reader:{get:()=>({PORT:0,SEARCH_PATH:'app,,shared'})}});
    assert.throws(()=>config.get('../main'),TypeError);
    assert.throws(()=>config.get(),TypeError);
    const badType=new Config({reader:{get:()=>({PORT:65536})}});
    assert.throws(()=>badType.get(),TypeError);
    const badPortType=new Config({reader:{get:()=>({PORT:true})}});
    assert.throws(()=>badPortType.get(),TypeError);
    const badSearchPath=new Config({reader:{get:()=>({SEARCH_PATH:'app,,shared'})}});
    assert.throws(()=>badSearchPath.get(),TypeError);
});
