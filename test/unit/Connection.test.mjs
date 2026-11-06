import {test} from 'node:test';
import assert from 'node:assert/strict';
import Connection from '../../src/Connection.mjs';

test('connection clones configuration, returns one owned client and disconnects once',async()=>{
    let config, destroyed=0;
    const source={client:'sqlite3',connection:{filename:':memory:'}};
    const connection=new Connection({knexFactory:async value=>{config=value;return {destroy:async()=>{destroyed++;}};}});
    await connection.init(source);
    assert.notEqual(config,source);
    assert.notEqual(config.connection,source.connection);
    assert.equal(connection.getClient().destroy instanceof Function,true);
    await Promise.all([connection.disconnect(),connection.disconnect()]);
    await connection.disconnect();
    assert.equal(destroyed,1);
    assert.throws(()=>connection.getClient());
    await assert.rejects(connection.init(source));
});

test('connection rejects access and repeated or concurrent initialization',async()=>{
    let finish;
    const connection=new Connection({knexFactory:()=>new Promise(resolve=>{finish=resolve;})});
    assert.throws(()=>connection.getClient());
    const initializing=connection.init({client:'sqlite3'});
    await assert.rejects(connection.init({client:'sqlite3'}));
    await new Promise(resolve=>setImmediate(resolve));
    const closing=connection.disconnect();
    assert.throws(()=>connection.getClient());
    const destroyed=[];
    finish({destroy:async()=>destroyed.push(true)});
    await initializing;
    await closing;
    assert.deepEqual(destroyed,[true]);
    assert.throws(()=>connection.getClient());
});

test('failed initialization is terminal and destroy failures propagate once',async()=>{
    const failure=new Error('factory failure');
    const broken=new Connection({knexFactory:async()=>{throw failure;}});
    await assert.rejects(broken.init({client:'pg'}),error=>error===failure);
    await assert.rejects(broken.init({client:'pg'}));
    const closeError=new Error('destroy failure');
    let calls=0;
    const connection=new Connection({knexFactory:async()=>({destroy:async()=>{calls++;throw closeError;}})});
    await connection.init({client:'sqlite3'});
    const results=await Promise.allSettled([connection.disconnect(),connection.disconnect()]);
    assert.deepEqual(results.map(result=>result.status),['rejected','rejected']);
    assert.equal(results[0].reason,closeError);
    assert.equal(results[1].reason,closeError);
    assert.equal(calls,1);
});

test('disconnect before initialization makes the Connection terminal',async()=>{
    const connection=new Connection({knexFactory:async()=>assert.fail('factory must not run')});
    await connection.disconnect();
    assert.throws(()=>connection.getClient());
    await assert.rejects(connection.init({client:'sqlite3'}));
});
