// @ts-check
/** @namespace Test_Dem_Preprocessor @description Routes fixture DEM contracts by DI provenance. */
const consumers=new Map([
    ['Test_Dem_Consumer_A','Test_Dem_Provider_A'],
    ['Test_Dem_Consumer_B','Test_Dem_Provider_B'],
]);
const providerConfigs=new Map([
    ['Test_Dem_Provider_A','Test_Dem_Config_A'],
    ['Test_Dem_Provider_B','Test_Dem_Config_B'],
]);
const connections=new Map([
    ['Test_Dem_Provider_A','Test_Dem_Connection_Main'],
    ['Test_Dem_Provider_B','Test_Dem_Connection_Main'],
]);
/** @param {any} id @returns {boolean} */
const contract=id=>id.addressKind==='teq' && id.exportName==='default' && id.lifestyle==='S' && id.wrappers.length===0;
/** @param {any} context @param {string} address @returns {number} */
const occurrences=(context,address)=>context.stack.filter((item)=>item.address===address).length;
export default function Preprocessor() {
    return function (id,context) {
        const repo=['TeqFw_Dem_Api_RepositoryProvider','TeqFw_Dem_Api_RepositoryBatch'].includes(id.address);
        const config=id.address==='TeqFw_Dem_RDb_Api_Configuration';
        const connection=id.address==='TeqFw_Dem_RDb_Connection';
        if (!repo && !config && !connection) return id;
        if (connection && id.lifestyle==='T') return id;
        if (!contract(id)) throw new Error('Unexpected selector for a routed DEM contract.');
        if (repo) {
            const target=consumers.get(context.parent?.address);
            if (!target) throw new Error('Repository routing requires an explicit fixture consumer.');
            return {...id,address:target};
        }
        if (config) {
            if (context.parent?.address!=='TeqFw_Dem_RDb_Provider') throw new Error('Configuration routing requires a DEM-RDB Provider.');
            const matches=[...providerConfigs].filter(([provider])=>occurrences(context,provider)===1);
            if (matches.length!==1) throw new Error('Configuration routing is ambiguous.');
            return {...id,address:matches[0][1]};
        }
        if (context.parent===null) return id;
        if (context.parent.address==='Test_Dem_Consumer_Other') return {...id,address:'Test_Dem_Connection_Other'};
        if (context.parent.address==='TeqFw_Dem_RDb_Provider') {
            const matches=[...connections].filter(([provider])=>occurrences(context,provider)===1);
            if (matches.length!==1) throw new Error('Connection routing is ambiguous.');
            return {...id,address:matches[0][1]};
        }
        throw new Error('Connection routing requires an explicit placement.');
    };
}
