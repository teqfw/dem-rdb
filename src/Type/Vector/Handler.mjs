// @ts-check
/**
 * @namespace TeqFw_Dem_RDb_Type_Vector_Handler
 * @description DEM Runtime handler for dense fixed-dimension vectors.
 */
export default class Handler {
    /** @param {object} deps @param {TeqFw_Dem_Repository_Error} deps.errors */
    constructor({errors}) {
        this.name='teqfw.dem_rdb.vector';
        /** @param {any} value @param {TeqFw_Dem_RDb_VectorParams} params @returns {Array<number>} */
        const vector=function (value,params) {
            if (!Array.isArray(value) || value.length!==params.dimensions || value.some(component=>typeof component!=='number' || !Number.isFinite(component)))
                throw errors.create({code:'INVALID_INPUT',message:'Vector value must contain exactly the declared number of finite numeric components.'});
            return [...value];
        };
        /** @param {any} value @param {TeqFw_Dem_RDb_VectorParams} params @returns {Array<number>} */
        this.normalize=vector;
        /** @param {any} value @param {TeqFw_Dem_RDb_VectorParams} params @returns {Array<number>} */
        this.copy=vector;
        /** @param {any} value @param {TeqFw_Dem_RDb_VectorParams} params @returns {Array<number>} */
        this.fromLiteral=vector;
    }
}
export const __deps__=Object.freeze({default:Object.freeze({errors:'TeqFw_Dem_Repository_Error$'})});
