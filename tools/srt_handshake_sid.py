"""Decode SRT handshake extensions from a pcap: prints the Stream ID (SID) the caller sends and which
extension types are present (1=HSREQ, 2=HSRSP, 3=KMREQ i.e. encryption offered, 5=SID).

Capture first, e.g.:  sudo tcpdump -i <iface> -w srt.pcap 'udp port 8897 and host <camera-ip>'
Then:                 python3 -I srt_handshake_sid.py srt.pcap

Used to discover that the Sony FX2 sends no SID with a bare srt://host URL. Assumes Ethernet + IPv4
without options (classic pcap, little-endian).
"""
import sys,struct
d=open(sys.argv[1],'rb').read()
off=24; seen=set()
while off<len(d):
    _,_,incl,_=struct.unpack('<IIII',d[off:off+16]); pkt=d[off+16:off+16+incl]; off+=16+incl
    udp=pkt[14+20+8:]  # eth+ip+udp
    if len(udp)<64 or not udp[0]&0x80: continue
    ext=udp[16+48:]; i=0
    while i+4<=len(ext):
        t,l=struct.unpack('>HH',ext[i:i+4]); body=ext[i+4:i+4+l*4]; i+=4+l*4
        if t==5:
            s=b''.join(body[j:j+4][::-1] for j in range(0,len(body),4)).rstrip(b'\0')
            seen.add(s)
        seen.add(("ext",t))
        pass
print(seen)
