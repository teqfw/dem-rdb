import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Connection from '../../src/Connection.mjs';

test('connection creates and destroys its package-owned Knex client once',async()=>{
    const connection=new Connection({createRequire});
    const source={client:'sqlite3',connection:{filename:':memory:'},useNullAsDefault:true,pool:{min:1,max:1}};
    await connection.init(source);
    const client=connection.getClient();
    assert.equal(await client.raw('SELECT 1 AS value').then(result=>result[0].value),1);
    source.connection.filename='changed';
    assert.equal(connection.getClient(),client);
    await connection.disconnect();
    await connection.disconnect();
    assert.throws(()=>connection.getClient());
    await assert.rejects(connection.init({client:'sqlite3'}));
});

test('failed initialization and disconnect before init are terminal',async()=>{
    const broken=new Connection({createRequire});
    await assert.rejects(broken.init({client:'no-such-knex-client'}));
    await assert.rejects(broken.init({client:'sqlite3'}));
    await broken.disconnect();
    assert.throws(()=>broken.getClient());

    const closed=new Connection({createRequire});
    await closed.disconnect();
    await assert.rejects(closed.init({client:'sqlite3'}));
    assert.throws(()=>closed.getClient());
});
