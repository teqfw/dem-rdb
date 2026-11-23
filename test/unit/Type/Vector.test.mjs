import assert from 'node:assert/strict';
import {test} from 'node:test';
import Provider from '../../../src/Type/Vector/Provider.mjs';
import Handler from '../../../src/Type/Vector/Handler.mjs';

test('vector type definition fixes its dense numeric domain and dimension parameter',()=>{
    const [definition]=new Provider().getDefinitions();
    assert.equal(definition.name,'teqfw.dem_rdb.vector');
    assert.deepEqual(definition.normalizeParams({dimensions:3}),{dimensions:3});
    for (const params of [{},{dimensions:0},{dimensions:1.5},{dimensions:2,element:'bit'}]) assert.throws(()=>definition.normalizeParams(params));
    assert.deepEqual(definition.literal.normalize([0.1,2,3],{dimensions:3}),[0.1,2,3]);
    assert.throws(()=>definition.literal.normalize([1,2],{dimensions:3}));
});

test('vector Runtime handler copies values and preserves JavaScript precision',()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{name:'DemRepositoryError',code})};
    const handler=new Handler({errors});
    const input=[0.1,1.2345678901234567];
    const output=handler.normalize(input,{dimensions:2});
    input[0]=8;assert.equal(output[0],0.1);
    const copy=handler.copy(output,{dimensions:2});copy[1]=4;assert.equal(output[1],1.2345678901234567);
    assert.throws(()=>handler.normalize([1],{dimensions:2}),{code:'INVALID_INPUT'});
    assert.throws(()=>handler.normalize([Infinity,0],{dimensions:2}),{code:'INVALID_INPUT'});
});
