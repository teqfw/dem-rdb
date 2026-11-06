import {test} from 'node:test';
import assert from 'node:assert/strict';
import Provider from '../../src/Provider.mjs';
test('provider opens once for concurrent calls', async () => {
    let opened = 0;
    const provider = new Provider({configuration:{get:async()=>({})},connection:{},adapter:{open:async()=>{opened++;return {get:async x=>x.path};}}});
    assert.deepEqual(await Promise.all([provider.get({path:'/a'}),provider.get({path:'/b'})]), ['/a','/b']);
    assert.equal(opened,1);
});


test('single and batch calls share the same configured backend',async()=>{
    let openings=0;
    const provider=new Provider({configuration:{get:async()=>({})},connection:{},adapter:{open:async()=>{openings++;return {get:async()=> 'single',execute:async()=> 'batch'};}}});
    assert.deepEqual(await Promise.all([provider.get({path:'/a'}),provider.execute({operations:[]})]),['single','batch']);
    assert.equal(openings,1);
});

test('provider injects its selected Connection and closes its backend once',async()=>{
    let opens=0,closes=0,disconnects=0;
    const connection={disconnect:async()=>{disconnects++;}};
    const provider=new Provider({
        connection,
        configuration:{get:async()=>({model:{entities:{}}})},
        adapter:{open:async options=>{opens++;assert.equal(options.connection,connection);return {get:async()=>({}),close:async()=>{closes++;}};}},
        errors:{create:({code,message})=>Object.assign(new Error(message),{code})},
    });
    await provider.get({path:'/item'});
    await Promise.all([provider.close(),provider.close()]);
    await provider.close();
    assert.equal(opens,1);
    assert.equal(closes,1);
    assert.equal(disconnects,0);
});
