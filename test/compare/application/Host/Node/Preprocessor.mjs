// @ts-check
/** @namespace Host_Node_Preprocessor @description Selects the comparison Provider and Configuration. */
export default function Preprocessor() {
    return function (id,context) {
        if (id.address==='TeqFw_Dem_Api_RepositoryProvider'||id.address==='TeqFw_Dem_Api_RepositoryBatch') {
            if (id.addressKind!=='teq'||id.exportName!=='default'||id.lifestyle!=='S'||id.wrappers.length||context.parent?.address!=='Demo_Workflow') throw new Error('Unexpected comparison Provider request.');
            return {...id,address:'Host_Node_Provider'};
        }
        if (id.address==='TeqFw_Dem_RDb_Api_Configuration') {
            if (id.addressKind!=='teq'||id.exportName!=='default'||id.lifestyle!=='S'||id.wrappers.length||context.parent?.address!=='TeqFw_Dem_RDb_Provider') throw new Error('Unexpected comparison Configuration request.');
            if (context.stack.filter(item=>item.address==='Host_Node_Provider').length!==1) throw new Error('Ambiguous comparison Configuration request.');
            return {...id,address:'Host_Node_Configuration'};
        }
        if (id.address==='TeqFw_Dem_RDb_Connection' && context.parent?.address==='TeqFw_Dem_RDb_Provider'
            && id.addressKind==='teq'&&id.exportName==='default'&&id.lifestyle==='S'&&!id.wrappers.length) return id;
        return id;
    };
}
