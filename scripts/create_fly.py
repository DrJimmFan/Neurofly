"""Rebuild with Blender 5.2: blender --background --python scripts/create_fly.py"""
import bpy, math, os, random
from mathutils import Vector
random.seed(42)
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(ROOT,'assets'),exist_ok=True)
os.makedirs(os.path.join(ROOT,'public','models'),exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def material(name,color,rough=.5,alpha=1,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,alpha);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,alpha);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;p.inputs['Alpha'].default_value=alpha
 if alpha<1:m.surface_render_method='DITHERED';m.use_transparent_shadow=True
 return m
body=material('Warm ochre chitin',(.23,.105,.035),.48)
headmat=material('Head chitin schematic toggle',(.23,.105,.035),.48)
stripe=material('Abdominal bands',(.065,.035,.018),.6)
eye=material('Ruby compound eyes',(.56,.024,.012),.27)
facet=material('Eye facet highlight',(.72,.055,.022),.35)
wingmat=material('Translucent wing membrane',(.66,.79,.75),.22,.28)
veinmat=material('Fine wing veins',(.23,.3,.22),.7,.65)
hair=material('Setae',(.11,.065,.025),.8)
bpy.ops.object.armature_add();rig=bpy.context.object;rig.name='NVFLY_Rig'
bpy.ops.object.mode_set(mode='EDIT');eb=rig.data.edit_bones;eb.remove(eb[0])
def bone(name,head,tail,parent=None):
 b=eb.new(name);b.head=head;b.tail=tail
 if parent:b.parent=eb[parent]
bone('root',(0,0,0),(0,0,.3));bone('thorax',(0,0,.35),(0,0,.8),'root');bone('head',(0,-.32,.7),(0,-.62,.73),'thorax');bone('abdomen',(0,.22,.62),(0,.9,.48),'thorax')
for side in [-1,1]:
 s='L' if side<0 else 'R'
 bone('wing_'+s,(side*.14,.05,.78),(side*.86,.82,.82),'thorax')
 bone('antenna_'+s,(side*.1,-.56,.82),(side*.19,-.82,.87),'head')
 for i in range(3):
  a=(side*.18,(i-1)*.22,.57);b=(side*.48,(i-1)*.42,.32);c=(side*.69,(i-1)*.55,.08)
  bone(f'leg_{s}{i}_upper',a,b,'thorax');bone(f'leg_{s}{i}_lower',b,c,f'leg_{s}{i}_upper');bone(f'leg_{s}{i}_foot',c,(side*.78,c[1]-.1,.035),f'leg_{s}{i}_lower')
bpy.ops.object.mode_set(mode='OBJECT')
def bind(obj,name,mat):
 obj.data.materials.append(mat);obj.parent=rig
 vg=obj.vertex_groups.new(name=name);vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
 mod=obj.modifiers.new('Articulated skin','ARMATURE');mod.object=rig
 for p in obj.data.polygons:p.use_smooth=True
 return obj
def ellipsoid(name,loc,scale,mat,bn,segments=20,rings=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return bind(o,bn,mat)
def rod(name,a,b,r,mat,bn):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=r,radius2=r*.65,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_quaternion=(b-a).to_track_quat('Z','Y');o.rotation_mode='QUATERNION';bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return bind(o,bn,mat)
ellipsoid('Thorax',(0,0,.63),(.25,.32,.25),body,'thorax')
ellipsoid('Head',(0,-.4,.73),(.27,.21,.23),headmat,'head')
for i in range(6):
 ellipsoid('Abdominal segment '+str(i),(0,.28+i*.12,.59-i*.029),(.24*(1-i*.1),.13,.19*(1-i*.09)),body if i%2==0 else stripe,'abdomen')
for side in [-1,1]:
 s='L' if side<0 else 'R';center=Vector((side*.21,-.45,.77))
 ellipsoid('Compound eye '+s,center,(.145,.16,.19),eye,'head',24,16)
 for i in range(68):
  t=2.39996*i;y=1-2*(i+.5)/68;rad=math.sqrt(1-y*y);normal=Vector((rad*math.cos(t),rad*math.sin(t),y));p=center+Vector((normal.x*.145,normal.y*.16,normal.z*.19))
  ellipsoid('Ommatidium',p,(.013,.013,.013),facet,'head',6,4)
 rod('Antenna', (side*.1,-.56,.82),(side*.19,-.78,.88),.021,body,'antenna_'+s)
 rod('Arista',(side*.19,-.74,.88),(side*.3,-.83,1.04),.005,hair,'antenna_'+s)
 for k in range(4):rod('Arista bristle',(side*(.2+k*.018),-.75-k*.015,.9+k*.027),(side*(.27+k*.018),-.8-k*.015,.93+k*.027),.002,hair,'antenna_'+s)
 for i in range(3):
  a=(side*.18,(i-1)*.22,.57);b=(side*.48,(i-1)*.42,.32);c=(side*.69,(i-1)*.55,.08);d=(side*.78,c[1]-.1,.035)
  for n,p,q,r in [('upper',a,b,.027),('lower',b,c,.017),('foot',c,d,.01)]:rod('Leg '+s+str(i)+n,p,q,r,body,f'leg_{s}{i}_{n}')
 # Flat, tapered wing with radial and cross veins.
 pivot=Vector((side*.14,.05,.78));pts=[(0,0),(.35,-.06),(.7,.18),(.84,.55),(.72,.86),(.48,.92),(.22,.62)]
 verts=[tuple(pivot+Vector((side*x,y,.045*math.sin(y*3)))) for x,y in pts]
 mesh=bpy.data.meshes.new('Wing membrane');mesh.from_pydata(verts,[],[tuple(range(7))]);mesh.update();o=bpy.data.objects.new('Wing '+s,mesh);bpy.context.collection.objects.link(o);bind(o,'wing_'+s,wingmat)
 for k in range(7):rod('Wing edge',verts[k],verts[(k+1)%7],.003,veinmat,'wing_'+s)
 for k in [2,3,4,5]:rod('Longitudinal vein',verts[0],verts[k],.0035,veinmat,'wing_'+s)
 rod('Cross vein',tuple(pivot+Vector((side*.33,.23,.026))),tuple(pivot+Vector((side*.59,.43,.04))),.0028,veinmat,'wing_'+s)
for i in range(85):
 t=random.uniform(0,math.tau);z=random.uniform(-.5,1);r=math.sqrt(1-z*z);p=Vector((.245*r*math.cos(t),.30*r*math.sin(t),.63+.245*z));rod('Thoracic seta',p,p+Vector((p.x,p.y,p.z-.63)).normalized()*.045,.0022,hair,'thorax')
# Join mesh parts while retaining skin weights and material boundaries; this
# reduces hundreds of draw calls to one primitive per material.
bpy.ops.object.select_all(action='DESELECT')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();bpy.context.object.name='NVFLY_Optimized_Skin'
# Each named NLA strip exports as a browser animation clip.
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
for clip in ['Idle','Antennae','Groom','Walk','Flutter','Hover']:
 rig.animation_data_create();rig.animation_data.action=bpy.data.actions.new(clip)
 for frame in range(1,50,4):
  t=(frame-1)/48*math.tau
  for pb in rig.pose.bones:
   pb.rotation_mode='XYZ';pb.rotation_euler=(0,0,0);pb.location=(0,0,0)
   if pb.name=='thorax':pb.rotation_euler.x=.025*math.sin(t)
   if pb.name.startswith('antenna'):pb.rotation_euler.z=(.15 if clip=='Antennae' else .055)*math.sin(t+(0 if pb.name.endswith('L') else 1))
   if pb.name.startswith('wing'):pb.rotation_euler.y=(.7*math.sin(t*4) if clip in ['Flutter','Hover'] else .025*math.sin(t))*(1 if pb.name.endswith('L') else -1)
   if pb.name.startswith('leg'):
    phase=0 if ('L0' in pb.name or 'R1' in pb.name or 'L2' in pb.name) else math.pi
    if clip=='Walk':pb.rotation_euler.x=.3*math.sin(t+phase);pb.rotation_euler.z=.12*math.cos(t+phase)
    if clip=='Groom' and '0_' in pb.name:pb.rotation_euler.y=.6+.25*math.sin(t*2);pb.rotation_euler.x=-.45
    if clip=='Hover':pb.rotation_euler.x=.35
   if pb.name=='root' and clip=='Hover':pb.location.z=.15+.06*math.sin(t)
   pb.keyframe_insert('rotation_euler',frame=frame);pb.keyframe_insert('location',frame=frame)
 action=rig.animation_data.action;track=rig.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,1,action);rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=True
for pb in rig.pose.bones:pb.rotation_euler=(0,0,0);pb.location=(0,0,0)
bpy.context.scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets','NVFLY.blend'))
for track in rig.animation_data.nla_tracks:track.mute=False
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public','models','nvfly.glb'),export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_skins=True,export_yup=True,export_apply=False)
print('NVFLY_ASSET_COMPLETE')
