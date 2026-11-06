// @ts-check
/** @namespace Test_Dem_Connection_Other @description Other host connection wrapper. */
export default class Other {
    /** @param {{inner:any}} deps */
    constructor({inner}) { this.init=cfg=>inner.init(cfg);this.getClient=()=>inner.getClient();this.disconnect=()=>inner.disconnect(); }
}
export const __deps__=Object.freeze({default:Object.freeze({inner:'TeqFw_Dem_RDb_Connection$$'})});
