import {randomUUID} from 'node:crypto';
import {test,expect,_electron as electron} from '@playwright/test';
import {resolve} from 'node:path';

test('home town can be saved and read back in Settings',async()=>{
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));
 env.HARMONY_TEST_PROFILE='test-'+randomUUID().replaceAll('-','');delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.getByRole('button',{name:'Open settings'}).click();
  await page.getByLabel('Town or city').fill('Portland, Oregon');
  await page.getByLabel('Latitude (optional)').fill('45.5');await page.getByLabel('Longitude (optional)').fill('-122.6');
  await page.getByRole('button',{name:'Save home town'}).click();await expect(page.getByRole('status').filter({hasText:'Home town saved'})).toBeVisible();
  await page.getByRole('button',{name:'Close panel'}).click();await page.getByRole('button',{name:'Open settings'}).click();
  await expect(page.getByLabel('Town or city')).toHaveValue('Portland, Oregon');await expect(page.getByLabel('Latitude (optional)')).toHaveValue('45.5');
 }finally{await app.close();}
});
