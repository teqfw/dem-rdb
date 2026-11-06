// @ts-check
/** @namespace Test_Dem_Connection_Main @description Main host connection wrapper. */
export default class Main {
    /** @param {{inner:any}} deps */
    constructor({inner}) {
        let accesses=0;
        this.init=cfg=>inner.init(cfg);
        this.getClient=()=>{accesses++;return inner.getClient();};
        this.getClientCalls=()=>accesses;
        this.disconnect=()=>inner.disconnect();
    }
}
export const __deps__=Object.freeze({default:Object.freeze({inner:'TeqFw_Dem_RDb_Connection$$'})});
