/** Dry run: does the installed local model ask for the right reminder or memory function for everyday requests?
 * Sends fixed requests to the real local brain with the reminder tools offered, parses what it asks for and compares
 * it with what was expected. Nothing is stored or run. Close HARMONY first so the GPU is free.
 * Usage: npm run local:tools-check
 */
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {LocalModelServer,localModelRoot,readLocalInstall} from '../core/local-model.ts';
import {LocalChatClient} from '../packages/reasoning/local-chat.ts';
import {ToolCallFilter,reminderModelTools,memoryModelTools,webModelTools,googleModelTools,projectModelTools,recallModelTool,desktopModelTools,statusModelTool,workspaceModelTool,modeModelTool,researchModelTool,skillsModelTool,godsEyeModelTool} from '../core/assistant-actions.ts';
import {withTime} from '../packages/reasoning/time-context.ts';

const root=resolve(import.meta.dirname,'..');
const install=readLocalInstall(localModelRoot(root));if(!install)throw new Error('Run "Set up local brain" first.');
const cases:[string,string|null][]=[
 ['Remind me to pick up the kids at 4:30.','set_reminder'],
 ['In 20 minutes remind me to check the laundry.','set_reminder'],
 ['Set a timer for 10 minutes.','set_timer'],
 ['Pasta timer, eight minutes please.','set_timer'],
 ['Remind me tomorrow at 9 to call the plumber about unit 12.','set_reminder'],
 ['What reminders do I have?','list_reminders'],
 ['Cancel that last reminder.','cancel_reminder'],
 ['Never mind the plumber reminder, cancel it.','cancel_reminder'],
 ['What is the capital of Australia?',null],
 ['Tell me a quick joke.',null],
 ['Remember that my plumber is Dave from unit 12.','remember'],
 ["Please remember Sam's soccer practice is on Tuesdays.",'remember'],
 ['Forget what I told you about the plumber.','forget'],
 ['I had a long day at work today.',null],
 ["What's the weather like in Madison tomorrow?",'get_weather'],
 ['Any news about the Packers?','get_news'],
 ['Who won the World Series this year?','web_search'],
 ['How much does a PlayStation 5 cost right now?','web_search'],
 ["What's on my calendar tomorrow?",'calendar_events'],
 ['Do I have any new emails?','check_email'],
 ['Did my landlord email me about rent?','check_email'],
 ["Switch to Maya's Garden.",'switch_project'],
 ['Start a new project called Moonlight Sessions.','switch_project'],
 ['Add a task to upload the October catalog.','project_note'],
 ['I finished the catalog upload.','project_note'],
 ['Where was I?','where_was_i'],
 ['Where did I leave off on Starfall?','where_was_i'],
 ['What did I tell you about the plumber last week?','recall'],
 ['Harmony, look at my screen. What does this error mean?','look_at_screen'],
 ['Can you read what is on my screen?','look_at_screen'],
 ['Open Spotify.','control_computer'],
 ['Pull up YouTube.','control_computer'],
 ['Pause the music.','control_computer'],
 ['Turn the volume up a bit.','control_computer'],
 ['Switch to Chrome.','control_computer'],
 ['What is a good name for a dog?',null],
 ['Harmony, status.','status_report'],
 ['Why are you so slow today?','status_report'],
 ['Save my place.','workspace'],
 ['Put me back to where I was Tuesday night.','workspace'],
 ['Harmony, lock in.','set_mode'],
 ['Go ghost.','set_mode'],
 ['Back to normal.','set_mode'],
 ['Idea: a light show synced to the hook.','project_note'],
 ['Research the best free tools for distributing CC0 music and tell me later.','research'],
 ['Read me the research.','research'],
 ['What skills do you have?','skills'],
 ['Disable computer control.','skills'],
 ['Open God\'s Eye.','gods_eye'],
 ['Show me flights over Chicago.','gods_eye'],
 ['Were there any earthquakes today?','gods_eye'],
 ['When can I see the space station tonight?','gods_eye'],
];
const server=new LocalModelServer(()=>install),client=new LocalChatClient();
let right=0;
try{
 const endpoint=await server.ensure(new AbortController().signal);
 for(const [text,expected] of cases){
  const filter=new ToolCallFilter();let said='';const start=performance.now();
  for await(const event of client.stream(endpoint,{text:withTime(text),maxOutputTokens:200,signal:new AbortController().signal,history:[],tools:[...reminderModelTools,statusModelTool,modeModelTool,...memoryModelTools,...webModelTools,googleModelTools.calendar,googleModelTools.gmail,...projectModelTools,recallModelTool,desktopModelTools.look,desktopModelTools.control,workspaceModelTool,researchModelTool,skillsModelTool,godsEyeModelTool]}))
   if(event.type==='text')said+=filter.push(event.text);
  const end=filter.finish();said+=end.text;
  const got=end.calls[0]?.name??null,ok=got===expected;if(ok)right++;
  console.log(`${ok?'OK  ':'MISS'} "${text}"\n     expected ${expected??'a normal answer'} · got ${got??'a normal answer'}${end.calls[0]?` ${JSON.stringify(end.calls[0].arguments)}`:''} · ${Math.round(performance.now()-start)} ms${said.trim()?`\n     said: ${said.trim().slice(0,120)}`:''}`);
 }
 console.log(`\n${right} of ${cases.length} as expected. This is a dry run: nothing was stored or changed.`);
}finally{await server.stop();}
