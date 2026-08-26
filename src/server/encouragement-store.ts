import fs from 'fs'
import path from 'path'
const DATA_DIR = process.env.DATA_DIR || '/persistent'
const DIR = path.join(DATA_DIR, 'timeline')
const FILE = path.join(DIR, 'encouragements.json')
export type EncouragementScope = 'permanent' | 'tags'
export interface Encouragement { id:string; text:string; scope:EncouragementScope; tags:string[]; enabled:boolean; created_at:string; updated_at:string }
function ensure(){fs.mkdirSync(DIR,{recursive:true})}
function read():Encouragement[]{ensure();try{const x=JSON.parse(fs.readFileSync(FILE,'utf8'));return Array.isArray(x)?x:[]}catch{return []}}
function write(x:Encouragement[]){ensure();const t=FILE+'.tmp';fs.writeFileSync(t,JSON.stringify(x,null,2));fs.renameSync(t,FILE)}
const tags=(x:any)=>Array.from(new Set((Array.isArray(x)?x:[]).map(String).map(s=>s.trim()).filter(Boolean))).slice(0,20)
export function listEncouragements(){return read().sort((a,b)=>b.updated_at.localeCompare(a.updated_at))}
export function createEncouragement(text:string,scope:EncouragementScope='permanent',tagList:any[]=[]){const now=new Date().toISOString();const r:Encouragement={id:`enc-${Date.now()}-${Math.random().toString(16).slice(2,7)}`,text:String(text||'').trim().slice(0,500),scope:scope==='tags'?'tags':'permanent',tags:tags(tagList),enabled:true,created_at:now,updated_at:now};if(!r.text)throw Error('鼓励话不能为空');if(r.scope==='tags'&&!r.tags.length)throw Error('标签鼓励至少选择一个标签');const all=read();all.unshift(r);write(all);return r}
export function createManyEncouragements(items:any[]){return items.map(x=>createEncouragement(x.text,x.scope,x.tags))}
export function updateEncouragement(id:string,patch:Partial<Encouragement>){const all=read(),r=all.find(x=>x.id===id);if(!r)throw Error('鼓励话不存在');if(patch.text!==undefined){r.text=String(patch.text).trim().slice(0,500);if(!r.text)throw Error('鼓励话不能为空')}if(patch.scope!==undefined)r.scope=patch.scope==='tags'?'tags':'permanent';if(patch.tags!==undefined)r.tags=tags(patch.tags);if(r.scope==='tags'&&!r.tags.length)throw Error('标签鼓励至少选择一个标签');if(patch.enabled!==undefined)r.enabled=!!patch.enabled;r.updated_at=new Date().toISOString();write(all);return r}
export function deleteEncouragement(id:string){const all=read(),next=all.filter(x=>x.id!==id);if(next.length===all.length)return false;write(next);return true}
export function matchingEncouragements(currentTags:string[]=[]){const wanted=new Set(currentTags);return listEncouragements().filter(x=>x.enabled&&(x.scope==='permanent'||x.tags.some(t=>wanted.has(t))))}
