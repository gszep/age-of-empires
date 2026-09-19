"""Disassemble the Shader Model 2 build (`Aon9` chunk) of a compiled DXBC.

    python3 tools/probes/sm2dis.py <depot>/resources/_common/shaders/d3d11/Water_ps.so

DE's shaders ship with a Direct3D 9 build beside the SM4 one, and its token
stream is documented; `strings` on the same file names the inputs, and the
`Aon9` header maps them onto the registers here (samplers as
(SM4 slot, kind, SM2 sampler) triples; constants are packed in `$Globals`
order, four scalars to a register). This is how the water's arithmetic
was read (`src/view/water.ts`); it touches the resources only, never the
executable.
"""
import struct, sys
OPS={0:'nop',1:'mov',2:'add',3:'sub',4:'mad',5:'mul',6:'rcp',7:'rsq',8:'dp3',9:'dp4',10:'min',11:'max',12:'slt',13:'sge',14:'exp',15:'log',16:'lit',17:'dst',18:'lrp',19:'frc',20:'m4x4',21:'m4x3',22:'m3x4',23:'m3x3',24:'m3x2',25:'call',26:'callnz',27:'loop',28:'ret',29:'endloop',30:'label',31:'dcl',32:'pow',33:'crs',34:'sgn',35:'abs',36:'nrm',37:'sincos',38:'rep',39:'endrep',40:'if',41:'ifc',42:'else',43:'endif',44:'break',45:'breakc',46:'mova',47:'defb',48:'defi',64:'texcoord',65:'texkill',66:'texld',67:'texbem',68:'texbeml',69:'texreg2ar',70:'texreg2gb',71:'texm3x2pad',72:'texm3x2tex',73:'texm3x3pad',74:'texm3x3tex',76:'texm3x3spec',77:'texm3x3vspec',78:'expp',79:'logp',80:'cnd',81:'def',82:'texreg2rgb',83:'texdp3tex',84:'texm3x2depth',85:'texdp3',86:'texm3x3',87:'texdepth',88:'cmp',89:'bem',90:'dp2add',91:'dsx',92:'dsy',93:'texldd',94:'setp',95:'texldl',96:'breakp'}
RT={0:'r',1:'v',2:'c',3:'t',4:'oPos',5:'oD',6:'o',7:'i',8:'oC',9:'oDepth',10:'s',11:'c',12:'c',13:'c',14:'b',15:'aL',16:'r16',17:'vPos',18:'l',19:'p'}
def reg(tok):
    t=((tok>>28)&7)|((tok>>8)&0x18); n=tok&0x7ff; return RT.get(t,'?%d'%t)+str(n)
def dst(tok):
    m=(tok>>16)&0xf; mask=''.join(c for i,c in enumerate('xyzw') if m&(1<<i)); mod=(tok>>20)&0xf
    return reg(tok)+('.'+mask if mask!='xyzw' else '')+('_sat' if mod&1 else '')
def src(tok):
    sw=(tok>>16)&0xff; s=''.join('xyzw'[(sw>>(2*i))&3] for i in range(4)); mod=(tok>>24)&0xf
    r=reg(tok); 
    if s=='xxxx': s='x'
    elif s=='yyyy': s='y'
    elif s=='zzzz': s='z'
    elif s=='wwww': s='w'
    if s!='xyzw': r+='.'+s
    return {0:r,1:'-'+r,2:'bias('+r+')',3:'-bias('+r+')',4:'sgn('+r+')',5:'-sgn('+r+')',6:'1-'+r,7:'x2('+r+')',8:'-x2('+r+')',9:'dz('+r+')',10:'dw('+r+')',11:'abs('+r+')',12:'-abs('+r+')',13:'!'+r}.get(mod,r)
def dis(code):
    i=0; out=[]
    ver=struct.unpack_from('<I',code,0)[0]; out.append('; version %08x'%ver); i=4
    while i+4<=len(code):
        tok=struct.unpack_from('<I',code,i)[0]
        if tok==0x0000FFFF: out.append('end'); break
        op=tok&0xffff
        if op==0xFFFE: n=(tok>>16)&0x7fff; i+=4+4*n; continue
        n=(tok>>24)&0xf; ctrl=(tok>>16)&0xff
        args=[struct.unpack_from('<I',code,i+4+4*k)[0] for k in range(n)]
        name=OPS.get(op,'op%d'%op)
        if op==81: out.append('def %s, %s'%(reg(args[0]), ', '.join('%g'%f for f in struct.unpack('<4f', struct.pack('<4I',*args[1:5])))))
        elif op==31:
            usage=args[0]&0x1f; d=dst(args[1]); 
            out.append('dcl%s %s'%(('_'+['position','blendweight','blendindices','normal','psize','texcoord','tangent','binormal','tessfactor','positiont','color','fog','depth','sample'][usage]) if 'v' in d or 'o' in d else ('_'+['2d','2d','cube','volume'][((args[0]>>27)&0xf)%4] if 's' in d else ''), d))
        elif n>=1:
            cmp={0:'',1:'_gt',2:'_eq',3:'_ge',4:'_lt',5:'_ne',6:'_le'}.get(ctrl,'') if op in (41,45) else ''
            out.append(name+cmp+' '+', '.join([dst(args[0])]+[src(a) for a in args[1:]]))
        else: out.append(name)
        i+=4+4*n
    return out
data=open(sys.argv[1],'rb').read()
n=struct.unpack_from('<I',data,28)[0]; offs=struct.unpack_from('<%dI'%n,data,32)
for o in offs:
    if data[o:o+4]==b'Aon9':
        size=struct.unpack_from('<I',data,o+4)[0]; body=data[o+8:o+8+size]
        codeOff=struct.unpack_from('<I',body,12)[0]; codeSize=struct.unpack_from('<I',body,8)[0]
        print('\n'.join(dis(body[codeOff:codeOff+codeSize])))
