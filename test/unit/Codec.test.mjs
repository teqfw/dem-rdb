import {test} from 'node:test';
import assert from 'node:assert/strict';
import Codec from '../../src/Codec.mjs';
const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
const codec=new Codec({errors,normalize:{record:({record})=>record}});
test('exact types have reversible storage even without native precision',()=>{
    const attributes=[{name:'wide',type:{name:'integer',params:{bits:64,unsigned:true}}},{name:'decimal',type:{name:'decimal',params:{precision:100,scale:50}}},{name:'binary',type:{name:'binary'}},{name:'json',type:{name:'json'}}];
    const entity={attributes,primaryKey:null,uniqueKeys:{},indexes:{},relations:{}};
    const record={wide:'18446744073709551615',decimal:'0.'+'0'.repeat(49)+'1',binary:'AP8=',json:{b:2,a:[1]}};
    for(const dialect of ['sqlite3','pg','mysql2']) assert.deepEqual(codec.decode(entity,codec.encode({entity,record,dialect})),record);
    assert.equal(codec.type({attribute:attributes[1],dialect:'mysql2',indexed:false}),'longblob');
});
test('unsafe driver numeric conversion and invalid UTF8 fail explicitly',()=>{
    const entity={attributes:[{name:'wide',type:{name:'integer'}}]};
    assert.throws(()=>codec.decode(entity,{wide:9007199254740992}),{code:'STORAGE'});
    assert.throws(()=>codec.decode({attributes:[{name:'text',type:{name:'text'}}]},{text:Buffer.from([255])}),{code:'STORAGE'});
});
test('PostgreSQL vector codec explicitly stores widened float32 values',()=>{
    const attribute={name:'embedding',type:{name:'teqfw.dem_rdb.vector',params:{dimensions:3}}};
    const entity={attributes:[attribute],primaryKey:null,uniqueKeys:{},indexes:{},relations:{}};
    const record={embedding:[-0,1.401298464324817e-45,-2]};
    const encoded=codec.encode({entity,record,dialect:'pg'});
    assert.equal(encoded.embedding,'[-0,1.401298464324817e-45,-2]');
    assert.deepEqual(codec.decode(entity,encoded),{embedding:[-0,1.401298464324817e-45,-2]});
    assert.throws(()=>codec.encode({entity,record:{embedding:[1,2]},dialect:'pg'}),{code:'UNSUPPORTED'});
    assert.throws(()=>codec.encode({entity,record:{embedding:[Number.MAX_VALUE,0,0]},dialect:'pg'}),{code:'UNSUPPORTED'});
    assert.equal(codec.type({attribute,dialect:'pg',indexed:false}),'vector(3)');
    assert.throws(()=>codec.type({attribute,dialect:'mysql2',indexed:false}),{code:'UNSUPPORTED'});
});
test('SQLite vectors use precision-preserving JSON text',()=>{
    const attribute={name:'embedding',type:{name:'teqfw.dem_rdb.vector',params:{dimensions:2}}};
    const entity={attributes:[attribute],primaryKey:null,uniqueKeys:{},indexes:{},relations:{}};
    const record={embedding:[-0,1.2345678901234567]};
    const encoded=codec.encode({entity,record,dialect:'sqlite3'});
    assert.equal(encoded.embedding,'[-0,1.2345678901234567]');
    assert.deepEqual(codec.decode(entity,encoded),record);
    assert.equal(codec.type({attribute,dialect:'sqlite3',indexed:false}),'text');
});
