export type BankTestCase = { input: string; expected: string; isHidden: boolean }
export type BankEntry = {
  id: string
  title: string
  topic: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  description: string
  testCases: BankTestCase[]
  referenceSolutions: { PYTHON: string; JAVASCRIPT: string; TYPESCRIPT: string }
  timeComplexity: string
  spaceComplexity: string
}

type Family = Omit<BankEntry, 'id' | 'title' | 'description' | 'testCases'> & {
  slug: string
  name: string
  build: (variant: number, context: string) => Pick<BankEntry, 'description' | 'testCases'>
}

const contexts = [
  'Telemetry', 'Inventory', 'Transit', 'Billing', 'Search', 'Monitoring', 'Scheduling', 'Analytics', 'Messaging', 'Storage',
  'Security', 'Payments', 'Logistics', 'Media', 'Education', 'Healthcare', 'Energy', 'Retail', 'Gaming', 'Travel',
  'Support', 'Identity', 'Delivery', 'Trading', 'Operations',
]

const tc = (input: string, expected: string, isHidden = false): BankTestCase => ({ input, expected, isHidden })
const solutions = (PYTHON: string, JAVASCRIPT: string) => ({ PYTHON, JAVASCRIPT, TYPESCRIPT: JAVASCRIPT })
const parseNumbersPy = `import sys\na=list(map(int,sys.stdin.read().split()))`
const parseNumbersJs = `const a=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).filter(Boolean).map(Number);`

const families: Family[] = [
  {
    slug: 'count-above', name: 'Count Values Above Limit', topic: 'Arrays', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nt=a[0]; nums=a[2:]; print(sum(x>t for x in nums))`, `${parseNumbersJs}\nconst t=a[0],nums=a.slice(2);console.log(nums.filter(x=>x>t).length);`),
    build: (v, c) => { const t = v - 12; return { description: `# ${c} Threshold\n\nThe first input line contains a fixed threshold **${t}** and the number of readings. The second line contains the readings. Print how many readings are strictly greater than ${t}.\n\nInput: \`threshold n\`, then \`n\` integers.`, testCases: [tc(`${t} 5\n${t-1} ${t} ${t+1} ${t+8} ${t-3}`, '2'), tc(`${t} 3\n${t+1} ${t+2} ${t+3}`, '3'), tc(`${t} 4\n${t} ${t-1} ${t-2} ${t-3}`, '0', true), tc(`${t} 1\n${t+100}`, '1', true)] } },
  },
  {
    slug: 'divisible-sum', name: 'Sum Multiples', topic: 'Arrays', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nd=a[0]; print(sum(x for x in a[2:] if x%d==0))`, `${parseNumbersJs}\nconst d=a[0];console.log(a.slice(2).filter(x=>x%d===0).reduce((s,x)=>s+x,0));`),
    build: (v, c) => { const d = v % 8 + 2; return { description: `# ${c} Multiples\n\nGiven divisor **${d}** and a list of integers, print the sum of values divisible by ${d}. Print 0 when none qualify.\n\nInput: \`divisor n\`, then \`n\` integers.`, testCases: [tc(`${d} 5\n${d} ${d+1} ${d*2} -${d} ${d+1}`, String(d*2)), tc(`${d} 3\n1 2 3`, String([1,2,3].filter(x=>x%d===0).reduce((a,b)=>a+b,0))), tc(`${d} 4\n${d*3} ${d*4} ${d*5} ${d*6}`, String(d*18), true), tc(`${d} 1\n0`, '0', true)] } },
  },
  {
    slug: 'rotate-right', name: 'Rotate Sequence Right', topic: 'Arrays', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`${parseNumbersPy}\nk=a[0]; nums=a[2:]; k%=len(nums); print(*((nums[-k:]+nums[:-k]) if k else nums))`, `${parseNumbersJs}\nlet k=a[0],x=a.slice(2);k%=x.length;console.log((k?x.slice(-k).concat(x.slice(0,-k)):x).join(' '));`),
    build: (v, c) => { const k = v % 9 + 1; return { description: `# Rotate ${c} Queue\n\nRotate the sequence right by **${k}** positions. Rotation wraps around and ${k} may exceed the sequence length.\n\nInput: \`k n\`, then \`n\` integers. Output the rotated integers separated by spaces.`, testCases: [tc(`${k} 5\n1 2 3 4 5`, (()=>{const a=[1,2,3,4,5],q=k%5;return (q?a.slice(-q).concat(a.slice(0,-q)):a).join(' ')})()), tc(`${k} 1\n9`, '9'), tc(`${k} 4\n-2 0 7 8`, (()=>{const a=[-2,0,7,8],q=k%4;return (q?a.slice(-q).concat(a.slice(0,-q)):a).join(' ')})(), true)] } },
  },
  {
    slug: 'max-window', name: 'Maximum Fixed Window Sum', topic: 'Sliding Window', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nk=a[0]; x=a[2:]; s=sum(x[:k]); best=s\nfor i in range(k,len(x)):\n s+=x[i]-x[i-k]; best=max(best,s)\nprint(best)`, `${parseNumbersJs}\nconst k=a[0],x=a.slice(2);let s=x.slice(0,k).reduce((p,q)=>p+q,0),best=s;for(let i=k;i<x.length;i++){s+=x[i]-x[i-k];best=Math.max(best,s)}console.log(best);`),
    build: (v, c) => { const k = v % 4 + 2; const x=[3,-2,7,1,5,-4,6,2].slice(0,k+3); const best=Math.max(...x.slice(0,x.length-k+1).map((_,i)=>x.slice(i,i+k).reduce((a,b)=>a+b,0))); return { description: `# ${c} Peak Window\n\nFor a sequence and fixed window length **${k}**, print the largest sum among all contiguous windows of exactly ${k} values.`, testCases: [tc(`${k} ${x.length}\n${x.join(' ')}`, String(best)), tc(`${k} ${k}\n${Array(k).fill(-2).join(' ')}`, String(-2*k)), tc(`${k} ${k+2}\n${Array.from({length:k+2},(_,i)=>i+1).join(' ')}`, String(Array.from({length:k},(_,i)=>i+3).reduce((a,b)=>a+b,0)), true)] } },
  },
  {
    slug: 'first-unique', name: 'First Unique Character', topic: 'Hash Maps', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(k)',
    referenceSolutions: solutions(`from collections import Counter\ns=input().strip(); c=Counter(s); print(next((x for x in s if c[x]==1),-1))`, `const s=require('fs').readFileSync(0,'utf8').trim();const c={};for(const x of s)c[x]=(c[x]||0)+1;console.log([...s].find(x=>c[x]===1)||-1);`),
    build: (_v, c) => ({ description: `# ${c} First Unique Symbol\n\nGiven a non-empty lowercase string, print its first character that occurs exactly once. Print \`-1\` if every character repeats.`, testCases: [tc('swiss', 'w'), tc('aabbcc', '-1'), tc('algorithm', 'a', true), tc('zzxxy', 'y', true)] }),
  },
  {
    slug: 'balanced-brackets', name: 'Validate Brackets', topic: 'Stacks', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`import sys\ns=sys.stdin.read().strip(); st=[]; pairs={')':'(',']':'[','}':'{'}\nfor x in s:\n if x in '([{': st.append(x)\n elif not st or st.pop()!=pairs[x]: print('false'); break\nelse: print('true' if not st else 'false')`, `const s=require('fs').readFileSync(0,'utf8').trim(),st=[],p={')':'(',']':'[','}':'{'};let ok=true;for(const x of s){if('([{'.includes(x))st.push(x);else if(st.pop()!==p[x]){ok=false;break}}console.log(ok&&st.length===0?'true':'false');`),
    build: (_v, c) => ({ description: `# ${c} Bracket Validation\n\nGiven a string containing only round, square, and curly brackets, print \`true\` when every opening bracket is closed by the correct type in the correct order; otherwise print \`false\`.`, testCases: [tc('([]{})', 'true'), tc('([)]', 'false'), tc('', 'true', true), tc('(((', 'false', true)] }),
  },
  {
    slug: 'pair-target', name: 'Pair With Target Sum', topic: 'Hash Maps', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`${parseNumbersPy}\nt=a[0]; seen=set(); ok=False\nfor x in a[2:]:\n if t-x in seen: ok=True; break\n seen.add(x)\nprint(str(ok).lower())`, `${parseNumbersJs}\nconst t=a[0],seen=new Set();let ok=false;for(const x of a.slice(2)){if(seen.has(t-x)){ok=true;break}seen.add(x)}console.log(ok);`),
    build: (v, c) => { const t=v*2-20; return { description: `# ${c} Target Pair\n\nDetermine whether two different positions in the list sum to **${t}**. Print \`true\` or \`false\`.\n\nInput: \`target n\`, then the values.`, testCases: [tc(`${t} 4\n${t-3} 3 8 9`, 'true'), tc(`${t} 3\n${t} 1 2`, 'false'), tc(`${t} 2\n${t/2} ${t/2}`, 'true', true), tc(`${t} 1\n${t}`, 'false', true)] } },
  },
  {
    slug: 'missing-number', name: 'Find Missing Number', topic: 'Math', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nn=a[0]; print(n*(n+1)//2-sum(a[1:]))`, `${parseNumbersJs}\nconst n=a[0];console.log(n*(n+1)/2-a.slice(1).reduce((s,x)=>s+x,0));`),
    build: (v, c) => { const n=v+5, missing=v%(n+1); const nums=Array.from({length:n+1},(_,i)=>i).filter(x=>x!==missing); return { description: `# ${c} Missing Identifier\n\nOne number is missing from the integers 0 through **${n}**. Given the remaining ${n} distinct values, print the missing number.`, testCases: [tc(`${n}\n${nums.join(' ')}`, String(missing)), tc('1\n1', '0'), tc('4\n0 1 2 3', '4', true)] } },
  },
  {
    slug: 'merge-intervals', name: 'Merge Overlapping Intervals', topic: 'Sorting', difficulty: 'MEDIUM', timeComplexity: 'O(n log n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`${parseNumbersPy}\nit=iter(a[1:]); xs=sorted(zip(it,it)); out=[]\nfor s,e in xs:\n if not out or s>out[-1][1]: out.append([s,e])\n else: out[-1][1]=max(out[-1][1],e)\nprint('\\n'.join(f'{s} {e}' for s,e in out))`, `${parseNumbersJs}\nconst n=a[0],x=[];for(let i=0;i<n;i++)x.push([a[1+2*i],a[2+2*i]]);x.sort((p,q)=>p[0]-q[0]);const out=[];for(const z of x){if(!out.length||z[0]>out[out.length-1][1])out.push(z);else out[out.length-1][1]=Math.max(out[out.length-1][1],z[1])}console.log(out.map(z=>z.join(' ')).join('\\n'));`),
    build: (v, c) => { const d=v%5; return { description: `# Merge ${c} Ranges\n\nMerge all overlapping closed intervals. Output merged intervals sorted by start, one \`start end\` pair per line. Touching endpoints overlap.`, testCases: [tc(`4\n1 ${3+d}\n2 6\n8 10\n9 ${12+d}`, `1 ${Math.max(3+d,6)}\n8 ${12+d}`), tc('1\n2 5', '2 5'), tc('3\n5 7\n1 2\n3 4', '1 2\n3 4\n5 7', true)] } },
  },
  {
    slug: 'diagonal-difference', name: 'Matrix Diagonal Difference', topic: 'Matrices', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nn=a[0]; x=a[1:]; print(abs(sum(x[i*n+i]-x[i*n+n-1-i] for i in range(n))))`, `${parseNumbersJs}\nconst n=a[0],x=a.slice(1);let d=0;for(let i=0;i<n;i++)d+=x[i*n+i]-x[i*n+n-1-i];console.log(Math.abs(d));`),
    build: (v, c) => { const x=v%7+1; return { description: `# ${c} Matrix Difference\n\nGiven an \`n x n\` integer matrix, print the absolute difference between the sums of its primary and secondary diagonals.`, testCases: [tc(`3\n${x} 2 3\n4 ${x+1} 6\n7 8 ${x+2}`, String(Math.abs((x+x+1+x+2)-(3+x+1+7)))), tc('1\n-8', '0'), tc('2\n1 2\n3 4', '0', true)] } },
  },
  {
    slug: 'shortest-path', name: 'Shortest Unweighted Path', topic: 'Graphs', difficulty: 'MEDIUM', timeComplexity: 'O(n + m)', spaceComplexity: 'O(n + m)',
    referenceSolutions: solutions(`${parseNumbersPy}\nfrom collections import deque\nn,m,s,t=a[:4]; g=[[] for _ in range(n)]; p=4\nfor _ in range(m):\n u,v=a[p:p+2];p+=2;g[u].append(v);g[v].append(u)\nd=[-1]*n;d[s]=0;q=deque([s])\nwhile q:\n u=q.popleft()\n for v in g[u]:\n  if d[v]<0:d[v]=d[u]+1;q.append(v)\nprint(d[t])`, `${parseNumbersJs}\nconst[n,m,s,t]=a;let p=4,g=Array.from({length:n},()=>[]);for(let i=0;i<m;i++){let u=a[p++],v=a[p++];g[u].push(v);g[v].push(u)}let d=Array(n).fill(-1),q=[s];d[s]=0;for(let h=0;h<q.length;h++)for(const v of g[q[h]])if(d[v]<0){d[v]=d[q[h]]+1;q.push(v)}console.log(d[t]);`),
    build: (v, c) => { const n=v%4+5; return { description: `# ${c} Route Distance\n\nGiven an undirected unweighted graph, print the minimum number of edges from source to target, or \`-1\` if unreachable. Vertices are numbered 0 to n-1.`, testCases: [tc(`${n} 4 0 3\n0 1\n1 2\n2 3\n0 4`, '3'), tc('4 1 0 3\n0 1', '-1'), tc('3 2 1 1\n0 1\n1 2', '0', true)] } },
  },
  {
    slug: 'top-k-frequency', name: 'Top K Frequent Values', topic: 'Heaps', difficulty: 'MEDIUM', timeComplexity: 'O(n + u log u)', spaceComplexity: 'O(u)',
    referenceSolutions: solutions(`${parseNumbersPy}\nfrom collections import Counter\nk=a[0]; c=Counter(a[2:]); print(*[x for x,_ in sorted(c.items(),key=lambda z:(-z[1],z[0]))[:k]])`, `${parseNumbersJs}\nconst k=a[0],c=new Map();for(const x of a.slice(2))c.set(x,(c.get(x)||0)+1);console.log([...c].sort((p,q)=>q[1]-p[1]||p[0]-q[0]).slice(0,k).map(x=>x[0]).join(' '));`),
    build: (v, c) => { const k=v%3+1; return { description: `# ${c} Most Frequent ${k}\n\nPrint the **${k}** most frequent values. Order by decreasing frequency, breaking ties by smaller numeric value.\n\nInput: \`k n\`, then values.`, testCases: [tc(`${k} 8\n1 1 2 2 2 3 3 4`, [2,1,3].slice(0,k).join(' ')), tc('1 4\n5 6 6 5', '5'), tc(`${k} ${k}\n${Array.from({length:k},(_,i)=>i+1).join(' ')}`, Array.from({length:k},(_,i)=>i+1).join(' '), true)] } },
  },
  {
    slug: 'longest-consecutive', name: 'Longest Consecutive Sequence', topic: 'Hash Sets', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`${parseNumbersPy}\ns=set(a[1:]); best=0\nfor x in s:\n if x-1 not in s:\n  y=x\n  while y in s:y+=1\n  best=max(best,y-x)\nprint(best)`, `${parseNumbersJs}\nconst s=new Set(a.slice(1));let best=0;for(const x of s)if(!s.has(x-1)){let y=x;while(s.has(y))y++;best=Math.max(best,y-x)}console.log(best);`),
    build: (v, c) => { const start=v-10,len=v%6+2; const seq=Array.from({length:len},(_,i)=>start+i); return { description: `# ${c} Consecutive Run\n\nGiven unsorted integers, print the length of the longest set of consecutive values. Duplicate values do not extend a run.`, testCases: [tc(`${len+3}\n${[99,...seq.slice().reverse(),start].join(' ')}`, String(len)), tc('4\n10 30 20 40', '1'), tc('0\n', '0', true)] } },
  },
  {
    slug: 'first-position', name: 'First Binary Search Position', topic: 'Binary Search', difficulty: 'MEDIUM', timeComplexity: 'O(log n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nt=a[0]; x=a[2:];lo=0;hi=len(x)\nwhile lo<hi:\n m=(lo+hi)//2\n if x[m]<t:lo=m+1\n else:hi=m\nprint(lo if lo<len(x) and x[lo]==t else -1)`, `${parseNumbersJs}\nconst t=a[0],x=a.slice(2);let l=0,r=x.length;while(l<r){const m=(l+r)>>1;if(x[m]<t)l=m+1;else r=m}console.log(l<x.length&&x[l]===t?l:-1);`),
    build: (v, c) => { const t=v-8; return { description: `# ${c} First Position\n\nIn a non-decreasing array, print the zero-based index of the first occurrence of **${t}**, or \`-1\` when absent. Your algorithm must run in logarithmic time.`, testCases: [tc(`${t} 6\n${t-2} ${t} ${t} ${t} ${t+1} ${t+3}`, '1'), tc(`${t} 3\n${t-3} ${t-2} ${t-1}`, '-1'), tc(`${t} 1\n${t}`, '0', true)] } },
  },
  {
    slug: 'run-length', name: 'Run-Length Encoding', topic: 'Strings', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`s=input().strip();out=[];i=0\nwhile i<len(s):\n j=i\n while j<len(s) and s[j]==s[i]:j+=1\n out.append(s[i]+str(j-i));i=j\nprint(''.join(out))`, `const s=require('fs').readFileSync(0,'utf8').trim();let out='',i=0;while(i<s.length){let j=i;while(j<s.length&&s[j]===s[i])j++;out+=s[i]+(j-i);i=j}console.log(out);`),
    build: (v, c) => { const n=v%7+1; return { description: `# ${c} Run Encoding\n\nCompress a non-empty alphanumeric string by replacing each maximal run with its character followed by the run length.`, testCases: [tc(`${'a'.repeat(n)}bbbcc`, `a${n}b3c2`), tc('xyz', 'x1y1z1'), tc('11122', '1322', true)] } },
  },
  {
    slug: 'anagram-check', name: 'Anagram Check', topic: 'Strings', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(k)',
    referenceSolutions: solutions(`from collections import Counter\na=input().strip();b=input().strip();print(str(Counter(a)==Counter(b)).lower())`, `const x=require('fs').readFileSync(0,'utf8').trim().split(/\\r?\\n/),c=s=>{const m={};for(const q of s)m[q]=(m[q]||0)+1;return m},a=c(x[0]||''),b=c(x[1]||'');console.log(Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]));`),
    build: (_v, c) => ({ description: `# ${c} Anagram Check\n\nGiven two lowercase strings on separate lines, print \`true\` when they contain exactly the same character counts; otherwise print \`false\`.`, testCases: [tc('silent\nlisten', 'true'), tc('binary\nbrainz', 'false'), tc('aabb\nbaba', 'true', true), tc('a\naa', 'false', true)] }),
  },
  {
    slug: 'normalized-palindrome', name: 'Normalized Palindrome', topic: 'Two Pointers', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`s=''.join(x.lower() for x in input() if x.isalnum());print(str(s==s[::-1]).lower())`, `const s=require('fs').readFileSync(0,'utf8').toLowerCase().replace(/[^a-z0-9]/g,'');console.log(s===[...s].reverse().join(''));`),
    build: (_v, c) => ({ description: `# ${c} Normalized Palindrome\n\nIgnore punctuation, spaces, and letter case. Print \`true\` if the remaining letters and digits read the same forward and backward.`, testCases: [tc('A man, a plan, a canal: Panama', 'true'), tc('Apex Coder', 'false'), tc('No lemon, no melon!', 'true', true)] }),
  },
  {
    slug: 'list-gcd', name: 'Greatest Common Divisor of List', topic: 'Math', difficulty: 'EASY', timeComplexity: 'O(n log m)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nfrom math import gcd\nfrom functools import reduce\nprint(reduce(gcd,(abs(x) for x in a[1:])))`, `${parseNumbersJs}\nconst gcd=(x,y)=>y?gcd(y,x%y):Math.abs(x);console.log(a.slice(1).reduce(gcd));`),
    build: (v, c) => { const g=v%9+2; return { description: `# ${c} Common Divisor\n\nPrint the greatest common divisor of all integers in the non-empty list. Values may be negative; the result must be non-negative.`, testCases: [tc(`4\n${g*2} ${g*3} ${g*5} ${g*7}`, String(g)), tc('3\n-12 18 30', '6'), tc('1\n17', '17', true)] } },
  },
  {
    slug: 'prime-count', name: 'Count Primes Through N', topic: 'Number Theory', difficulty: 'MEDIUM', timeComplexity: 'O(n log log n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`n=int(input());p=[True]*(n+1)\nif n>=0:p[0]=False\nif n>=1:p[1]=False\nfor i in range(2,int(n**.5)+1):\n if p[i]:p[i*i:n+1:i]=[False]*(((n-i*i)//i)+1)\nprint(sum(p))`, `const n=+require('fs').readFileSync(0,'utf8').trim(),p=Array(n+1).fill(true);if(n>=0)p[0]=false;if(n>=1)p[1]=false;for(let i=2;i*i<=n;i++)if(p[i])for(let j=i*i;j<=n;j+=i)p[j]=false;console.log(p.filter(Boolean).length);`),
    build: (v, c) => { const n=v*4+20; const count=(m:number)=>Array.from({length:m+1},(_,x)=>x).filter(x=>x>=2&&Array.from({length:Math.floor(Math.sqrt(x))-1},(_,i)=>i+2).every(d=>x%d)).length; return { description: `# ${c} Prime Count\n\nGiven **${n}**, print how many prime numbers are less than or equal to it. Use an algorithm efficient for large n.`, testCases: [tc(String(n), String(count(n))), tc('1', '0'), tc('2', '1'), tc('100', '25', true)] } },
  },
  {
    slug: 'minimum-coins', name: 'Minimum Coin Count', topic: 'Dynamic Programming', difficulty: 'HARD', timeComplexity: 'O(amount * coins)', spaceComplexity: 'O(amount)',
    referenceSolutions: solutions(`${parseNumbersPy}\namount=a[0]; coins=a[2:];d=[amount+1]*(amount+1);d[0]=0\nfor x in range(1,amount+1):\n for c in coins:\n  if c<=x:d[x]=min(d[x],d[x-c]+1)\nprint(d[amount] if d[amount]<=amount else -1)`, `${parseNumbersJs}\nconst amount=a[0],coins=a.slice(2),d=Array(amount+1).fill(amount+1);d[0]=0;for(let x=1;x<=amount;x++)for(const c of coins)if(c<=x)d[x]=Math.min(d[x],d[x-c]+1);console.log(d[amount]<=amount?d[amount]:-1);`),
    build: (v, c) => { const a=v%4+2,b=v%7+5,amount=a+b+1; const solve=(m:number,coins:number[])=>{const d=Array(m+1).fill(m+1);d[0]=0;for(let x=1;x<=m;x++)for(const q of coins)if(q<=x)d[x]=Math.min(d[x],d[x-q]+1);return d[m]>m?-1:d[m]}; return { description: `# ${c} Minimum Coins\n\nGiven an amount and reusable coin denominations, print the minimum number of coins needed, or \`-1\` when the amount cannot be formed.\n\nInput: \`amount coinCount\`, then denominations.`, testCases: [tc(`${amount} 3\n1 ${a} ${b}`, String(solve(amount,[1,a,b]))), tc('3 2\n2 4', '-1'), tc('0 2\n2 5', '0', true), tc('11 3\n1 5 7', '3', true)] } },
  },
  {
    slug: 'consensus-vote', name: 'Consensus Vote Finding', topic: 'Arrays', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nc=0;m=0\nfor x in a[1:]:\n if c==0:m=x\n c+=1 if x==m else -1\nprint(m)`, `${parseNumbersJs}\nlet c=0,m=0;for(const x of a.slice(1)){if(c===0)m=x;c+=x===m?1:-1}console.log(m);`),
    build: (v, c) => { const n=v%5+3,m=v*2+1; return { description: `# ${c} Consensus Vote\n\nGiven \`n\` and an array of integers where one element appears more than \`n/2\` times, find the majority element.\n\nInput: \`n\`, then \`n\` integers.`, testCases: [tc(`3\n${m} ${m} ${m-1}`, String(m)), tc(`5\n1 2 1 1 3`, '1'), tc(`7\n4 4 4 4 2 3 1`, '4', true), tc(`1\n2`, '2', true)] } },
  },
  {
    slug: 'bandwidth-distribution', name: 'Bandwidth Distribution', topic: 'Arrays', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`${parseNumbersPy}\nn=a[0];x=a[1:];res=[1]*n;left=1\nfor i in range(n):res[i]=left;left*=x[i]\nright=1\nfor i in range(n-1,-1,-1):res[i]*=right;right*=x[i]\nprint(*res)`, `${parseNumbersJs}\nconst n=a[0],x=a.slice(1),res=Array(n).fill(1);let l=1;for(let i=0;i<n;i++){res[i]=l;l*=x[i]}let r=1;for(let i=n-1;i>=0;i--){res[i]*=r;r*=x[i]}console.log(res.join(' '));`),
    build: (v, c) => ({ description: `# ${c} Bandwidth Distribution\n\nGiven \`n\` and an array of integers, compute an array where each element at index \`i\` is the product of all elements except the one at \`i\`, without using division.`, testCases: [tc(`4\n1 2 3 4`, '24 12 8 6'), tc(`5\n-1 1 0 -3 3`, '0 0 9 0 0'), tc(`3\n2 2 2`, '4 4 4', true), tc(`2\n0 0`, '0 0', true)] }),
  },
  {
    slug: 'deployment-steps', name: 'Deployment Steps', topic: 'Dynamic Programming', difficulty: 'EASY', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`n=int(input());a,b=1,1\nfor _ in range(n):a,b=b,a+b\nprint(a)`, `const n=+require('fs').readFileSync(0,'utf8').trim();let a=1,b=1;for(let i=0;i<n;i++){let t=a+b;a=b;b=t}console.log(a);`),
    build: (v, c) => ({ description: `# ${c} Deployment Sequence\n\nYou are deploying a system with \`n\` sequential steps. Each time you can either progress 1 or 2 steps. Find the number of distinct ways to complete the deployment.\n\nInput: \`n\``, testCases: [tc(`2`, '2'), tc(`3`, '3'), tc(`4`, '5', true), tc(`5`, '8', true)] }),
  },
  {
    slug: 'target-revenue', name: 'Target Revenue Subarray', topic: 'Hash Maps', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(n)',
    referenceSolutions: solutions(`${parseNumbersPy}\nt=a[0];x=a[2:];c={0:1};s=0;ans=0\nfor v in x:\n s+=v;ans+=c.get(s-t,0);c[s]=c.get(s,0)+1\nprint(ans)`, `${parseNumbersJs}\nconst t=a[0],x=a.slice(2),c=new Map([[0,1]]);let s=0,ans=0;for(const v of x){s+=v;ans+=c.get(s-t)||0;c.set(s,(c.get(s)||0)+1)}console.log(ans);`),
    build: (v, c) => { const t=v%10+5; return { description: `# ${c} Target Revenue\n\nGiven a target revenue \`k\` and \`n\` daily revenue entries, find the total number of continuous daily subarrays whose sum equals exactly \`k\`.\n\nInput: \`k n\`, then \`n\` integers.`, testCases: [tc(`${t} 4\n1 -1 ${t} 0`, '2'), tc(`3 3\n1 1 1`, '2'), tc(`5 4\n2 3 -2 5`, '2', true), tc(`0 3\n0 0 0`, '6', true)] } },
  },
  {
    slug: 'max-storage-volume', name: 'Max Storage Volume', topic: 'Two Pointers', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nres=0;l=0;r=len(a)-2;x=a[1:]\nwhile l<r:\n res=max(res,(r-l)*min(x[l],x[r]))\n if x[l]<x[r]:l+=1\n else:r-=1\nprint(res)`, `${parseNumbersJs}\nlet res=0,l=0,x=a.slice(1),r=x.length-1;while(l<r){res=Math.max(res,(r-l)*Math.min(x[l],x[r]));if(x[l]<x[r])l++;else r--;}console.log(res);`),
    build: (v, c) => ({ description: `# ${c} Storage Tanks\n\nGiven \`n\` non-negative integers representing heights of walls, find two walls that together with the x-axis form a container holding the most liquid. Print the max area.\n\nInput: \`n\`, then \`n\` integers.`, testCases: [tc(`9\n1 8 6 2 5 4 8 3 7`, '49'), tc(`2\n1 1`, '1'), tc(`4\n4 3 2 1`, '4', true), tc(`5\n1 2 1 2 1`, '4', true)] }),
  },
  {
    slug: 'unique-signal-stream', name: 'Unique Signal Stream', topic: 'Sliding Window', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(k)',
    referenceSolutions: solutions(`s=input().strip();seen={};l=0;best=0\nfor r,c in enumerate(s):\n if c in seen and seen[c]>=l:l=seen[c]+1\n seen[c]=r;best=max(best,r-l+1)\nprint(best)`, `const s=require('fs').readFileSync(0,'utf8').trim(),seen=new Map();let l=0,best=0;for(let r=0;r<s.length;r++){const c=s[r];if(seen.has(c)&&seen.get(c)>=l)l=seen.get(c)+1;seen.set(c,r);best=Math.max(best,r-l+1)}console.log(best);`),
    build: (v, c) => ({ description: `# ${c} Unique Signal\n\nGiven a string of characters representing incoming signals, find the length of the longest continuous sequence without repeating characters.`, testCases: [tc(`abcabcbb`, '3'), tc(`bbbbb`, '1'), tc(`pwwkew`, '3', true), tc(`abcdef`, '6', true)] }),
  },
  {
    slug: 'merge-system-logs', name: 'Merge System Logs', topic: 'Two Pointers', difficulty: 'EASY', timeComplexity: 'O(n+m)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nm,n=a[0],a[1];x=a[2:2+m];y=a[2+m:];res=[]\ni,j=0,0\nwhile i<m and j<n:\n if x[i]<y[j]:res.append(x[i]);i+=1\n else:res.append(y[j]);j+=1\nres.extend(x[i:m]);res.extend(y[j:n]);print(*res)`, `${parseNumbersJs}\nconst m=a[0],n=a[1],x=a.slice(2,2+m),y=a.slice(2+m),res=[];let i=0,j=0;while(i<m&&j<n){if(x[i]<y[j])res.push(x[i++]);else res.push(y[j++])}while(i<m)res.push(x[i++]);while(j<n)res.push(y[j++]);console.log(res.join(' '));`),
    build: (v, c) => ({ description: `# ${c} Merge Logs\n\nGiven two sorted arrays of log timestamps, merge them into a single sorted output. \n\nInput: \`m n\`, then \`m\` elements, then \`n\` elements.`, testCases: [tc(`3 3\n1 2 3\n2 5 6`, '1 2 2 3 5 6'), tc(`1 0\n1`, '1'), tc(`0 1\n1`, '1', true), tc(`2 2\n4 5\n1 2`, '1 2 4 5', true)] }),
  },
  {
    slug: 'server-hop-validation', name: 'Server Hop Validation', topic: 'Greedy', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nn=a[0];x=a[1:];m=0;ok=True\nfor i in range(n):\n if i>m:ok=False;break\n m=max(m,i+x[i])\nprint(str(ok).lower())`, `${parseNumbersJs}\nconst n=a[0],x=a.slice(1);let m=0,ok=true;for(let i=0;i<n;i++){if(i>m){ok=false;break}m=Math.max(m,i+x[i])}console.log(ok?'true':'false');`),
    build: (v, c) => ({ description: `# ${c} Server Hop\n\nYou are given an array of maximum hop lengths from each server. Determine if you can reach the last server starting from the first index. Print \`true\` or \`false\`.\n\nInput: \`n\` then \`n\` integers.`, testCases: [tc(`5\n2 3 1 1 4`, 'true'), tc(`5\n3 2 1 0 4`, 'false'), tc(`4\n0 2 3 1`, 'false', true), tc(`1\n0`, 'true', true)] }),
  },
  {
    slug: 'peak-revenue-window', name: 'Peak Revenue Subarray', topic: 'Dynamic Programming', difficulty: 'MEDIUM', timeComplexity: 'O(n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nx=a[1:];s=0;m=-float('inf')\nfor v in x:\n s=max(v,s+v);m=max(m,s)\nprint(m)`, `${parseNumbersJs}\nconst x=a.slice(1);let s=0,m=-Infinity;for(const v of x){s=Math.max(v,s+v);m=Math.max(m,s)}console.log(m);`),
    build: (v, c) => ({ description: `# ${c} Peak Revenue\n\nGiven an array of daily profit/loss figures, find the contiguous subarray containing at least one number which has the largest sum and print its sum.\n\nInput: \`n\` then \`n\` integers.`, testCases: [tc(`9\n-2 1 -3 4 -1 2 1 -5 4`, '6'), tc(`1\n1`, '1'), tc(`5\n5 4 -1 7 8`, '23', true), tc(`3\n-1 -2 -3`, '-1', true)] }),
  },
  {
    slug: 'search-insert-pos', name: 'Database Search Insert', topic: 'Binary Search', difficulty: 'EASY', timeComplexity: 'O(log n)', spaceComplexity: 'O(1)',
    referenceSolutions: solutions(`${parseNumbersPy}\nt=a[0];x=a[2:];l,r=0,len(x)\nwhile l<r:\n m=(l+r)//2\n if x[m]<t:l=m+1\n else:r=m\nprint(l)`, `${parseNumbersJs}\nconst t=a[0],x=a.slice(2);let l=0,r=x.length;while(l<r){let m=(l+r)>>1;if(x[m]<t)l=m+1;else r=m;}console.log(l);`),
    build: (v, c) => ({ description: `# ${c} Database Insert\n\nGiven a sorted array of distinct integers and a target value, return the index if the target is found. If not, return the index where it would be if it were inserted in order.\n\nInput: \`target n\`, then \`n\` integers.`, testCases: [tc(`5 4\n1 3 5 6`, '2'), tc(`2 4\n1 3 5 6`, '1'), tc(`7 4\n1 3 5 6`, '4', true), tc(`0 4\n1 3 5 6`, '0', true)] }),
  },
]

export const problemBank: BankEntry[] = families.flatMap((family) => contexts.map((context, index) => {
  const variant = index + 1
  const built = family.build(variant, context)
  return {
    id: `${family.slug}-${String(variant).padStart(2, '0')}`,
    title: `${context}: ${family.name}`,
    topic: family.topic,
    difficulty: family.difficulty,
    description: built.description,
    testCases: built.testCases,
    referenceSolutions: family.referenceSolutions,
    timeComplexity: family.timeComplexity,
    spaceComplexity: family.spaceComplexity,
  }
}))

export const problemBankTopics = [...new Set(problemBank.map((problem) => problem.topic))].sort()
