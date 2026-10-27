import json,sys
p=json.load(open(sys.argv[1],encoding='utf-8'))
roles=p.get('requiredRoles',[]); supplied=p.get('suppliedRoles',[])
missing=sorted(set(roles)-set(supplied)); duplicates=sorted({r for r in supplied if supplied.count(r)>1})
print(json.dumps({'ok':not missing and not duplicates,'missing':missing,'duplicates':duplicates},indent=2))
if missing or duplicates: raise SystemExit(2)
