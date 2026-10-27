/** What the Memory panel shows: everything HARMONY was asked to remember, newest first, plus how search works. */
export interface MemoryStatus {
 items:{id:string;text:string;createdAt:string;source:'voice'|'typed'|'screen';pinned?:boolean}[];limit:number;
 /** Present when recall is available: meaning search (model set up) or words only; whether conversations are kept. */
 recall?:{engine:'meaning'|'words';episodes:boolean;episodeCount:number;indexed:number;total:number;keepDays:number};
}
export interface MemorySearchHit {kind:'memory'|'episode'|'note'|'idea';id:string;text:string;at:string;project:string|null;score:number;}
export const emptyMemory:MemoryStatus={items:[],limit:200};
