import assert from 'node:assert/strict';
import test from 'node:test';
import { hasDraftContents, isDraftRevision, parseFieldDraft, shouldClearFieldDraft } from './field-draft-state.ts';

const now = Date.parse('2026-10-02T05:00:00Z');
const encode = (values: object, extra: object = {}) => JSON.stringify({savedAt:new Date(now).toISOString(),values,...extra});

test('legacy text-only drafts remain recoverable', () => {
  assert.deepEqual(parseFieldDraft(encode({projectId:'p1',internalNotes:'Private'}),now), {
    savedAt:new Date(now).toISOString(),values:{projectId:'p1',internalNotes:'Private'},photoIds:[],
  });
});

test('saved photo references and every daily field survive parsing', () => {
  const values = {projectId:'p1',workCompleted:'Work',internalNotes:'Notes',clientSummary:'Summary',blocker:'Delay',crewOnsite:'3',hoursWorked:'6.5',weather:'Rain',clientDecisionNeeded:'on'};
  assert.deepEqual(parseFieldDraft(encode(values,{photoIds:['photo1','photo1','photo2']}),now)?.photoIds,['photo1','photo2']);
  assert.deepEqual(parseFieldDraft(encode(values),now)?.values,values);
});

test('unknown values cannot create extra submitted form fields', () => {
  assert.deepEqual(parseFieldDraft(encode({projectId:'p1',role:'contractor',authProfileId:'other'}),now)?.values,{projectId:'p1'});
});

test('malformed, expired and future drafts are refused', () => {
  for (const raw of ['{','null','[]',encode(null!),encode([]),encode({internalNotes:42}),
    encode({}, {savedAt:new Date(now+1).toISOString()}),encode({}, {savedAt:new Date(now-86_400_001).toISOString()})]) {
    assert.equal(parseFieldDraft(raw,now),null);
  }
});

test('photo references must have a project and cannot contain paths or filter syntax', () => {
  for (const extra of [{photoIds:['valid']},{values:{projectId:'p1'},photoIds:'photo1'},
    {values:{projectId:'p1'},photoIds:['../../secret']},{values:{projectId:'p1'},photoIds:['id,other']},
    {values:{projectId:'p1'},photoIds:[null]}]) assert.equal(parseFieldDraft(encode({},extra),now),null);
});

test('an untouched form or project choice alone is not a draft', () => {
  const defaults={crewOnsite:'2',hoursWorked:'8',weather:'Clear',clientDecisionNeeded:'off'};
  assert.equal(hasDraftContents({projectId:'p2',...defaults},[],defaults),false);
  assert.equal(hasDraftContents({projectId:'p1',internalNotes:'   '},[],{}),false);
});

test('photos alone, modified numbers, weather and a decision flag are meaningful drafts', () => {
  const defaults={crewOnsite:'2',hoursWorked:'8',weather:'Clear',clientDecisionNeeded:'off'};
  assert.equal(hasDraftContents({projectId:'p1'},['photo1'],defaults),true);
  for (const [name,value] of Object.entries({crewOnsite:'3',hoursWorked:'6.5',weather:'Rain',clientDecisionNeeded:'on'})) {
    assert.equal(hasDraftContents({projectId:'p1',...defaults,[name]:value},[],defaults),true);
  }
});

const revision = 'e4bdb8d0-0e2f-4e5a-a23d-f79fae25bf93';

test('draft revision metadata survives recovery without changing legacy compatibility', () => {
  assert.equal(parseFieldDraft(encode({internalNotes:'Keep'}, {revision}),now)?.revision,revision);
  for (const invalid of ['',null,42,'../../other','token&draft=other']) {
    assert.equal(isDraftRevision(invalid),false);
    assert.equal(parseFieldDraft(encode({}, {revision:invalid}),now),null);
  }
});

test('successful cleanup clears only the exact submitted revision, never a later draft', () => {
  const raw=encode({internalNotes:'Keep'}, {revision});
  assert.equal(shouldClearFieldDraft(raw,revision),true);
  assert.equal(shouldClearFieldDraft(raw,'d8df1244-eebc-4431-a410-e0fb9849185f'),false);
  assert.equal(shouldClearFieldDraft(raw,null),false);
  assert.equal(shouldClearFieldDraft(raw,undefined),false);
  assert.equal(shouldClearFieldDraft(encode({internalNotes:'Legacy'}),revision),false);
});

test('cleanup refuses malformed storage and missing or invalid revision markers', () => {
  for (const raw of [null,'{','null','[]','{}']) assert.equal(shouldClearFieldDraft(raw,revision),false);
  for (const marker of [null,undefined,'',42,'../other']) {
    assert.equal(shouldClearFieldDraft(encode({}, {revision}),marker),false);
  }
});
