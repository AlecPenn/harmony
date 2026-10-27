import {platform,arch,availableParallelism,totalmem} from 'node:os';
import type {ToolDefinition} from './registry.ts';
export interface ComputerInfo {operatingSystem:string;architecture:string;logicalCores:number;memoryGiB:number;}
const read=():ComputerInfo=>({operatingSystem:platform(),architecture:arch(),logicalCores:availableParallelism(),memoryGiB:Math.round(totalmem()/1024**3*10)/10});
export const computerInfoTool:ToolDefinition={id:'system.information',version:1,name:'Computer overview',description:'Read operating system, architecture, available processor count and total memory.',risk:'SAFE',permissions:['system_info'],
 inputSchema:{type:'object',properties:{},required:[]},outputSchema:{type:'object',properties:{operatingSystem:{type:'string',maxLength:40},architecture:{type:'string',maxLength:40},logicalCores:{type:'number'},memoryGiB:{type:'number'}},required:['operatingSystem','architecture','logicalCores','memoryGiB']},available:()=>true,
 execute:async(_input,{signal})=>{signal.throwIfAborted();return read();},
 verify:async(_input,result,{signal})=>{signal.throwIfAborted();const actual=read(),r=result as ComputerInfo;return Object.keys(actual).every(key=>actual[key as keyof ComputerInfo]===r[key as keyof ComputerInfo]);}
};
