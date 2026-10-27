import type {ReadOnlyFiles} from '../files/read-only.ts';
import {actionInputHash} from '../permissions/policy.ts';
import type {ToolDefinition} from './registry.ts';
export function filePreviewTool(files:ReadOnlyFiles):ToolDefinition{
 const read=async(input:unknown,signal:AbortSignal)=>{const result=await files.readText('workspace',(input as {path:string}).path,signal);if(result.bytes>16384)throw new Error('Preview limited to 16 KiB');return result;};
 return {id:'files.preview',version:1,name:'Local text preview',description:'Read a small UTF-8 text file inside the explicitly selected folder.',risk:'SAFE',permissions:['selected_folder_read'],inputSchema:{type:'object',properties:{path:{type:'string',maxLength:512}},required:['path']},outputSchema:{type:'object',properties:{text:{type:'string',maxLength:16384},bytes:{type:'number'}},required:['text','bytes']},available:()=>true,
 execute:(input,context)=>read(input,context.signal),verify:async(input,result,context)=>actionInputHash(await read(input,context.signal))===actionInputHash(result)};
}
