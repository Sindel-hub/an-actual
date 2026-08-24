import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "usc-election-rules-test",
    firestore: { rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }
  });
});
after(async () => { await env?.cleanup(); });

async function seed(path, data) {
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data));
}

async function seedElection({ published=false, publicationPast=true, votingEnded=true }={}) {
  const now=Date.now();
  await seed("elections/usc-test", {
    candidatePublicationStart: new Date(now + (publicationPast ? -60000 : 60000)),
    votingStart: new Date(now-120000),
    votingEnd: new Date(now + (votingEnded ? -60000 : 60000)),
    resultPublicationStart: new Date(now-60000),
    finalized: votingEnded,
    resultsPublished: published,
    archived:false
  });
}

test("student may update only display profile fields, never role or eligibility", async () => {
  await env.clearFirestore();
  await seed("users/u1", { uid:"u1", studentId:"123456", email:"u1@gmail.com", role:"student", accountStatus:"approved", isVerifiedStudent:true, fullName:"Old", profilePhoto:"" });
  const db=env.authenticatedContext("u1",{role:"student",verifiedStudent:true}).firestore();
  await assertSucceeds(updateDoc(doc(db,"users/u1"),{fullName:"New"}));
  await assertFails(updateDoc(doc(db,"users/u1"),{role:"admin"}));
  await assertFails(updateDoc(doc(db,"users/u1"),{studentId:"999999"}));
});

test("legacy vote collection and anonymous ballots are inaccessible to browser clients", async () => {
  await env.clearFirestore(); await seedElection();
  const db=env.authenticatedContext("u1",{role:"student",verifiedStudent:true}).firestore();
  await assertFails(setDoc(doc(db,"votes/123456"),{presidentVote:"x"}));
  await assertFails(setDoc(doc(db,"elections/usc-test/ballots/b1"),{selections:{President:"c1"}}));
  await assertFails(getDoc(doc(db,"elections/usc-test/ballots/b1")));
});

test("candidate records fail closed before publication and become readable after publication", async () => {
  await env.clearFirestore(); await seedElection({publicationPast:false});
  await seed("elections/usc-test/candidates/c1",{approved:true,fullName:"Candidate",position:"President"});
  const db=env.authenticatedContext("u1",{role:"student",verifiedStudent:true}).firestore();
  await assertFails(getDoc(doc(db,"elections/usc-test/candidates/c1")));
  await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),"elections/usc-test"),{candidatePublicationStart:new Date(Date.now()-60000)}));
  await assertSucceeds(getDoc(doc(db,"elections/usc-test/candidates/c1")));
});

test("official results remain hidden until deliberate publication", async () => {
  await env.clearFirestore(); await seedElection({published:false});
  await seed("elections/usc-test/results/official",{results:[{candidateId:"c1",votes:1}]});
  const student=env.authenticatedContext("u1",{role:"student",verifiedStudent:true}).firestore();
  await assertFails(getDoc(doc(student,"elections/usc-test/results/official")));
  await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),"elections/usc-test"),{resultsPublished:true}));
  await assertSucceeds(getDoc(doc(student,"elections/usc-test/results/official")));
});

test("ordinary officers cannot read private tallies; canvassers can after polls close and finalization", async () => {
  await env.clearFirestore(); await seedElection({votingEnded:true});
  await seed("elections/usc-test/privateTallies/c1",{candidateId:"c1",votes:10});
  await seed("users/o1",{uid:"o1",role:"officer",accountStatus:"approved",isActive:true});
  await seed("users/o2",{uid:"o2",role:"officer",accountStatus:"approved",isActive:true});
  const officer=env.authenticatedContext("o1",{role:"officer"}).firestore();
  const canvasser=env.authenticatedContext("o2",{role:"officer",canvasser:true}).firestore();
  await assertFails(getDoc(doc(officer,"elections/usc-test/privateTallies/c1")));
  await assertSucceeds(getDoc(doc(canvasser,"elections/usc-test/privateTallies/c1")));
});

test("students can read only their own complaint", async () => {
  await env.clearFirestore();
  await seed("complaints/c1",{studentUid:"u1",studentId:"123456",studentEmail:"u1@gmail.com",status:"Submitted"});
  await seed("complaints/c2",{studentUid:"u2",studentId:"654321",studentEmail:"u2@gmail.com",status:"Submitted"});
  const db=env.authenticatedContext("u1",{role:"student",verifiedStudent:true}).firestore();
  await assertSucceeds(getDoc(doc(db,"complaints/c1")));
  await assertFails(getDoc(doc(db,"complaints/c2")));
});


test("suspended officer loses privileged read even with a stale officer claim", async () => {
  await env.clearFirestore(); await seedElection({votingEnded:true});
  await seed("users/o3",{uid:"o3",role:"officer",accountStatus:"suspended",isActive:false});
  await seed("elections/usc-test/privateTallies/c1",{candidateId:"c1",votes:10});
  const stale=env.authenticatedContext("o3",{role:"officer",canvasser:true}).firestore();
  await assertFails(getDoc(doc(stale,"elections/usc-test/privateTallies/c1")));
});

test("administrator Firestore access requires trusted admin role and approved active profile", async () => {
  await env.clearFirestore();
  await seed("users/a1",{uid:"a1",role:"admin",accountStatus:"approved",isActive:true,fullName:"Admin",profilePhoto:""});
  await seed("users/u2",{uid:"u2",role:"student",accountStatus:"approved",isActive:true,fullName:"Student",profilePhoto:""});
  const admin=env.authenticatedContext("a1",{role:"admin",email_verified:false}).firestore();
  const noClaim=env.authenticatedContext("a2",{role:"student",email_verified:true}).firestore();
  await assertSucceeds(getDoc(doc(admin,"users/u2")));
  await assertFails(getDoc(doc(noClaim,"users/u2")));
});

test("canvasser cannot read candidate tallies until the election is finalized even after voting end", async () => {
  await env.clearFirestore();
  const now=Date.now();
  await seed("elections/usc-test",{
    candidatePublicationStart:new Date(now-3600000), votingStart:new Date(now-7200000), votingEnd:new Date(now-60000),
    resultPublicationStart:new Date(now+3600000), finalized:false, resultsPublished:false, archived:false
  });
  await seed("users/o4",{uid:"o4",role:"officer",accountStatus:"approved",isActive:true,fullName:"Canvasser",profilePhoto:""});
  await seed("elections/usc-test/privateTallies/c1",{candidateId:"c1",votes:10});
  const canvasser=env.authenticatedContext("o4",{role:"officer",canvasser:true}).firestore();
  await assertFails(getDoc(doc(canvasser,"elections/usc-test/privateTallies/c1")));
});

test("browser clients cannot modify election schedules or election records", async () => {
  await env.clearFirestore();
  await seed("users/o5",{uid:"o5",role:"officer",accountStatus:"approved",isActive:true,fullName:"Officer",profilePhoto:""});
  const officer=env.authenticatedContext("o5",{role:"officer"}).firestore();
  await assertFails(setDoc(doc(officer,"elections/usc-new"),{title:"Injected election"}));
  await assertFails(setDoc(doc(officer,"election_config/current"),{electionId:"usc-new"}));
});

test("student profile update still works when an older profile has no profilePhoto field", async () => {
  await env.clearFirestore();
  await seed("users/u6", { uid:"u6", studentId:"111111", email:"u6@gmail.com", role:"student", accountStatus:"approved", isActive:true, isVerifiedStudent:true, fullName:"Old Name" });
  const db=env.authenticatedContext("u6",{role:"student",verifiedStudent:true}).firestore();
  await assertSucceeds(updateDoc(doc(db,"users/u6"),{fullName:"Updated Name"}));
});

test("officers cannot bypass the audited complaint mutation function with direct Firestore updates", async () => {
  await env.clearFirestore();
  await seed("users/o6",{uid:"o6",role:"officer",accountStatus:"approved",isActive:true,fullName:"Officer"});
  await seed("complaints/c6",{studentUid:"u6",studentId:"111111",studentEmail:"u6@gmail.com",status:"Submitted"});
  const officer=env.authenticatedContext("o6",{role:"officer"}).firestore();
  await assertFails(updateDoc(doc(officer,"complaints/c6"),{status:"Resolved"}));
});
