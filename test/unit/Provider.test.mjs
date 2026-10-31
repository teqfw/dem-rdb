import {test} from 'node:test';
import assert from 'node:assert/strict';
import Provider from '../../src/Provider.mjs';
test('provider opens once for concurrent calls', async () => {
    let opened = 0;
    const provider = new Provider({configuration:{get:async()=>({})},adapter:{open:async()=>{opened++;return {get:async x=>x.path};}}});
    assert.deepEqual(await Promise.all([provider.get({path:'/a'}),provider.get({path:'/b'})]), ['/a','/b']);
    assert.equal(opened,1);
});


test('single and batch calls share the same configured backend',async()=>{
    let openings=0;
    const provider=new Provider({configuration:{get:async()=>({})},adapter:{open:async()=>{openings++;return {get:async()=> 'single',execute:async()=> 'batch'};}}});
    assert.deepEqual(await Promise.all([provider.get({path:'/a'}),provider.execute({operations:[]})]),['single','batch']);
    assert.equal(openings,1);
});
