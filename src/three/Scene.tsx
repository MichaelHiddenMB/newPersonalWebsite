import { Canvas } from '@react-three/fiber';
import { useGLTF, CameraControls } from '@react-three/drei';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three'

function Scene() {
    return (
        <Canvas camera={{position: [0, 5, 10], fov: 90 }}><ambientLight /><Box /></Canvas>
    )
}

function Box() {
    const meshRef = useRef<THREE.Mesh>(null);
    
    useFrame(() => {
        meshRef.current!.rotation.y += 0.01;
    });

    return (
        <mesh ref={meshRef}><boxGeometry args={[5,5,5]} /> <meshStandardMaterial color="blue" /></mesh>
    )

}

export default Scene;