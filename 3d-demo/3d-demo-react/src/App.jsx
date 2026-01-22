import React, { useState, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Text, SpotLight } from "@react-three/drei";
import * as THREE from "three";
import { Physics, useBox } from "@react-three/cannon";

// API Configuration
const API_BASE_URL = "http://localhost:10000";

/* ============================= */
/*        PLAYER CONTROLS        */
/* ============================= */
function Player({ speed = 5 }) {
  const { camera } = useThree();
  const [position, setPosition] = useState([0, 1.5, 5]);
  const keys = useRef({});
  const mouse = useRef({ x: 0, y: 0 });
  const rotation = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleKeyDown = (e) => {
      keys.current[e.code] = true;
    };
    const handleKeyUp = (e) => {
      keys.current[e.code] = false;
    };
    const handleMouseMove = (e) => {
      mouse.current.x = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
      mouse.current.y = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  useFrame(() => {
    // Mouse look
    rotation.current.y -= mouse.current.x * 0.002;
    rotation.current.x -= mouse.current.y * 0.002;
    rotation.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.current.x));
    
    // Update camera rotation
    camera.rotation.set(rotation.current.x, rotation.current.y, 0);

    // Calculate movement direction
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(camera.up, forward).normalize();

    // Movement vector
    const move = new THREE.Vector3();
    if (keys.current['KeyW']) move.add(forward);
    if (keys.current['KeyS']) move.add(forward.clone().negate());
    if (keys.current['KeyA']) move.add(right.clone().negate());
    if (keys.current['KeyD']) move.add(right);

    if (move.length() > 0) {
      move.normalize().multiplyScalar(speed * 0.016); // 60 FPS
      setPosition([
        position[0] + move.x,
        position[1],
        position[2] + move.z
      ]);
    }

    // Update camera position
    camera.position.set(position[0], position[1], position[2]);

    // Reset mouse movement
    mouse.current.x = 0;
    mouse.current.y = 0;
  });

  return null;
}

/* ============================= */
/*        API SERVICE            */
/* ============================= */
const apiService = {
  async fetchAllRacks() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/racks`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching racks:", error);
      return { racks: [] };
    }
  },

  async fetchRack(rackId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rack/${rackId}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Error fetching rack ${rackId}:`, error);
      return null;
    }
  },

  async fetchRackNetwork(rackId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rack/${rackId}/network`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Error fetching network data for rack ${rackId}:`, error);
      return null;
    }
  },

  async fetchNetworkSummary() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/network/summary`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching network summary:", error);
      return null;
    }
  },

  async fetchRackServers(rackId) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rack/${rackId}/servers`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Error fetching servers for rack ${rackId}:`, error);
      return null;
    }
  },

  async fetchDatacenterStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/datacenter/status`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching datacenter status:", error);
      return null;
    }
  },

  async reloadData() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/reload`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error reloading data:", error);
      return null;
    }
  },

  async debugInfo() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/debug`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching debug info:", error);
      return null;
    }
  }
};

/* ============================= */
/*        SERVER UNIT            */
/* ============================= */
function ServerUnit({ position, serverData, viewMode, onServerClick }) {
  const [hovered, setHovered] = useState(false);
  const { status, temperature } = serverData;

  const getViewModeColor = () => {
    const statusObj = status || {};
    
    switch (viewMode) {
      case "normal":
        const overallStatus = statusObj.overall || "normal";
        if (overallStatus === "critical") return hovered ? "#ff3333" : "#ff0000";
        if (overallStatus === "warning") return hovered ? "#ffaa33" : "#ff9900";
        return hovered ? "#666666" : "#333333";
        
      case "thermal":
        if (temperature < 35) return "#0066ff";
        if (temperature < 48) return "#00ccff";
        if (temperature < 54) return "#00ffb3";
        if (temperature < 60) return "#bfff00";
        if (temperature < 66) return "#ffd400";
        if (temperature < 72) return "#ff8c00";
        return "#ff3300";
        
      case "power":
        const powerStatus = statusObj.power || "normal";
        if (powerStatus === "critical") return "#ff0000";
        if (powerStatus === "warning") return "#ffcc00";
        return "#00ff00";
        
      case "network":
        const networkStatus = statusObj.network || "normal";
        if (networkStatus === "critical") return "#ff0000";
        if (networkStatus === "warning") return "#ffcc00";
        return "#0077ff";
        
      case "cooling":
        const coolingStatus = statusObj.cooling || "normal";
        if (coolingStatus === "excessive") return "#0066ff";
        if (coolingStatus === "insufficient") return "#ff3300";
        return "#00ff99";
        
      default:
        return "#333333";
    }
  };

  const serverColor = getViewModeColor();

  return (
    <group position={position}>
      <mesh
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          onServerClick && onServerClick(serverData);
        }}
      >
        <boxGeometry args={[0.85, 0.095, 0.92]} />
        <meshStandardMaterial
          color={serverColor}
          emissive={serverColor}
          emissiveIntensity={hovered ? 0.5 : 0.2}
          roughness={0.4}
          metalness={0.6}
        />
      </mesh>

      {viewMode === "thermal" && (
        <Text 
          position={[0.5, -0.04, 0.471]} 
          fontSize={0.018} 
          color="#fff"
          anchorX="center"
        >
          {Math.round(temperature)}°C
        </Text>
      )}
      
      <Text 
        position={[-0.4, 0.03, 0.471]} 
        fontSize={0.016} 
        color="#fff"
        anchorX="center"
      >
        {serverData.server_id}
      </Text>
    </group>
  );
}

/* ============================= */
/*        NETWORK INDICATOR      */
/* ============================= */
function NetworkIndicator({ position, networkData }) {
  const [hovered, setHovered] = useState(false);
  
  if (!networkData || networkData.interface_count === 0) return null;
  
  const throughput = networkData.avg_throughput || 0;
  const status = networkData.status || 'normal';
  
  // Calculate color based on throughput utilization
  let color = "#00ff00"; // Normal
  let intensity = 0.3;
  
  if (status === 'critical') {
    color = "#ff0000";
    intensity = 0.8;
  } else if (status === 'warning') {
    color = "#ffcc00";
    intensity = 0.6;
  } else if (throughput > 50) {
    color = "#0077ff";
    intensity = 0.4;
  }
  
  // Size based on throughput
  const size = 0.03 + (throughput / 100) * 0.02;
  
  return (
    <group position={position}>
      <mesh
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[size, 8, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? intensity * 1.5 : intensity}
          transparent
          opacity={0.8}
        />
      </mesh>
      
      {hovered && (
        <Text 
          position={[0, size + 0.05, 0]} 
          fontSize={0.02} 
          color="#fff"
          anchorX="center"
          backgroundColor="rgba(0,0,0,0.7)"
          padding={0.01}
        >
          {Math.round(throughput)} Mbps
        </Text>
      )}
    </group>
  );
}

/* ============================= */
/*        DYNAMIC RACK           */
/* ============================= */
function DynamicRack({ position, rackData, viewMode, onRackClick }) {
  const [hovered, setHovered] = useState(false);
  const [servers, setServers] = useState([]);
  const [networkData, setNetworkData] = useState(null);
  const [loading, setLoading] = useState(true);

  const rackId = rackData.rack_id;
  const spacing = 0.11;
  const serverCount = rackData.server_count || 2;
  const startY = -((serverCount - 1) / 2) * spacing;

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Load servers
        const serversData = await apiService.fetchRackServers(rackId);
        if (serversData && serversData.servers) {
          setServers(serversData.servers);
        } else {
          const fallbackServers = Array.from({ length: serverCount }, (_, i) => ({
            server_id: i + 1,
            server_name: `Rack${rackId}_Server${i + 1}`,
            temperature: 40 + Math.random() * 20,
            status: { overall: "normal" }
          }));
          setServers(fallbackServers);
        }
        
        // Load network data if available
        if (rackData.has_network_data) {
          const network = await apiService.fetchRackNetwork(rackId);
          if (network) {
            setNetworkData(network);
          }
        }
      } catch (error) {
        console.error(`Error loading data for rack ${rackId}:`, error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
    
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [rackId, serverCount, rackData.has_network_data]);

  const handleRackClick = (e) => {
    e.stopPropagation();
    onRackClick && onRackClick(rackData);
  };

  const rackColor = rackData.status === "critical" ? "#3a0d0d" : 
                   rackData.status === "warning" ? "#3a2d0d" : "#1a1a1a";

  const borderColor = rackData.status === "critical" ? "#ff0000" : 
                     rackData.status === "warning" ? "#ff9900" : "#333333";

  return (
    <group 
      position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onClick={handleRackClick}
    >
      {/* RACK FRAME */}
      <mesh position={[-0.5, 0, 0]}>
        <boxGeometry args={[0.05, 2.2, 1]} />
        <meshStandardMaterial 
          color={hovered ? "#444" : rackColor}
          metalness={0.7}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0.5, 0, 0]}>
        <boxGeometry args={[0.05, 2.2, 1]} />
        <meshStandardMaterial 
          color={hovered ? "#444" : rackColor}
          metalness={0.7}
          roughness={0.4}
        />
      </mesh>

      {/* Top and bottom frames */}
      <mesh position={[0, -1.1, 0]}>
        <boxGeometry args={[1, 0.05, 1]} />
        <meshStandardMaterial 
          color={hovered ? "#444" : rackColor}
          metalness={0.7}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[1, 0.05, 1]} />
        <meshStandardMaterial 
          color={hovered ? "#444" : rackColor}
          metalness={0.7}
          roughness={0.4}
        />
      </mesh>

      {/* Border highlight */}
      <mesh position={[0, 0, 0.5]}>
        <boxGeometry args={[1.1, 2.3, 0.01]} />
        <meshBasicMaterial 
          color={borderColor}
          transparent
          opacity={hovered ? 0.3 : 0.1}
        />
      </mesh>

      {/* SERVERS */}
      {loading ? (
        <Text 
          position={[0, 0, 0.5]} 
          fontSize={0.03} 
          color="#aaa"
          anchorX="center"
        >
          Loading...
        </Text>
      ) : (
        servers.map((server, i) => {
          const y = startY + i * spacing;
          return (
            <ServerUnit
              key={server.server_id}
              position={[0, y, 0]}
              serverData={server}
              viewMode={viewMode}
              onServerClick={onRackClick}
            />
          );
        })
      )}

      {/* Network indicator on top of rack */}
      {networkData && viewMode === "network" && (
        <NetworkIndicator 
          position={[0, 1.2, 0]} 
          networkData={networkData.network_metrics}
        />
      )}

      {/* Rack label */}
      <Text 
        position={[0.6, 1.05, 0.5]} 
        fontSize={0.025} 
        color="#fff"
        anchorX="center"
      >
        R{rackId}
      </Text>
      
      {/* Temperature display */}
      <Text 
        position={[-0.6, 1.05, 0.5]} 
        fontSize={0.02} 
        color={rackData.temperature > 65 ? "#ff6666" : "#66ff66"}
        anchorX="center"
      >
        {rackData.temperature}°C
      </Text>
      
      {/* Network throughput display when in network view */}
      {viewMode === "network" && rackData.network && (
        <Text 
          position={[0, 1.05, 0.5]} 
          fontSize={0.015} 
          color="#66ccff"
          anchorX="center"
        >
          {rackData.network.avg_throughput || 0} Mbps
        </Text>
      )}
      
      {/* Status indicator */}
      <mesh position={[0, 1.1, 0.2]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial
          color={rackData.status === "critical" ? "#ff0000" : 
                 rackData.status === "warning" ? "#ffcc00" : "#00ff00"}
          emissive={rackData.status === "critical" ? "#ff0000" : 
                    rackData.status === "warning" ? "#ffcc00" : "#00ff00"}
          emissiveIntensity={0.5}
        />
      </mesh>
    </group>
  );
}

/* ============================= */
/*        DYNAMIC DATACENTER     */
/* ============================= */
function DynamicDatacenter({ viewMode, onRackClick }) {
  const [racks, setRacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadRacks = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiService.fetchAllRacks();
        if (data && data.racks && data.racks.length > 0) {
          setRacks(data.racks);
        } else {
          setError("No rack data received from server");
        }
      } catch (error) {
        console.error("Error loading racks:", error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    loadRacks();
    
    const interval = setInterval(loadRacks, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <group>
        <Text 
          position={[0, 2, 0]} 
          fontSize={0.1} 
          color="#fff"
          anchorX="center"
        >
          Loading racks...
        </Text>
      </group>
    );
  }

  if (error) {
    return (
      <group>
        <Text 
          position={[0, 2, 0]} 
          fontSize={0.05} 
          color="#ff6666"
          anchorX="center"
        >
          Error: {error}
        </Text>
      </group>
    );
  }

  if (racks.length === 0) {
    return (
      <group>
        <Text 
          position={[0, 2, 0]} 
          fontSize={0.05} 
          color="#aaa"
          anchorX="center"
        >
          No racks found
        </Text>
      </group>
    );
  }

  // Arrange racks based on their actual IDs
  const sortedRacks = [...racks].sort((a, b) => a.rack_id - b.rack_id);
  
  // Create two rows
  const midPoint = Math.ceil(sortedRacks.length / 2);
  const row1 = sortedRacks.slice(0, midPoint);
  const row2 = sortedRacks.slice(midPoint);

  return (
    <group>
      {/* First row (front) */}
      {row1.map((rack, i) => (
        <DynamicRack
          key={`rack-${rack.rack_id}`}
          position={[i * 1.5 - (row1.length * 1.5) / 2, 1.1, -2]}
          rackData={rack}
          viewMode={viewMode}
          onRackClick={onRackClick}
        />
      ))}
      
      {/* Second row (back) */}
      {row2.map((rack, i) => (
        <DynamicRack
          key={`rack-${rack.rack_id}`}
          position={[i * 1.5 - (row2.length * 1.5) / 2, 1.1, 2]}
          rackData={rack}
          viewMode={viewMode}
          onRackClick={onRackClick}
        />
      ))}
    </group>
  );
}

/* ============================= */
/*        NETWORK DETAILS MODAL  */
/* ============================= */
function NetworkDetailsModal({ isOpen, onClose, rackData, networkData }) {
  if (!isOpen || !networkData) return null;

  const { network_metrics, interfaces, total_interfaces } = networkData;
  
  const getStatusColor = (status) => {
    if (status === 'critical') return '#ef4444';
    if (status === 'warning') return '#f59e0b';
    return '#10b981';
  };

  const getThroughputColor = (throughput) => {
    if (throughput > 90) return '#ef4444';
    if (throughput > 70) return '#f59e0b';
    return '#10b981';
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1001,
    }}>
      <div style={{
        backgroundColor: '#1a1a1a',
        padding: '24px',
        borderRadius: '12px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8)',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflowY: 'auto',
        position: 'relative',
        border: '2px solid #3B82F6',
        color: '#fff',
      }}>
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: '#333',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: '#fff',
            padding: '5px 10px',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
        
        <h2 style={{ 
          margin: '0 0 20px 0', 
          color: '#fff', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px',
          fontSize: '20px',
        }}>
          <span style={{ fontSize: '24px' }}>🌐</span>
          Network Details - Rack {rackData.rack_id}
        </h2>
        
        {/* Network Summary */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '12px',
            marginBottom: '20px'
          }}>
            <div style={{ 
              backgroundColor: '#222', 
              padding: '16px', 
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>Total Throughput</div>
              <div style={{ 
                fontSize: '24px', 
                color: getThroughputColor(network_metrics.avg_throughput), 
                fontWeight: 'bold'
              }}>
                {network_metrics.total_throughput} Mbps
              </div>
            </div>
            
            <div style={{ 
              backgroundColor: '#222', 
              padding: '16px', 
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>Avg Throughput</div>
              <div style={{ 
                fontSize: '24px', 
                color: getThroughputColor(network_metrics.avg_throughput), 
                fontWeight: 'bold'
              }}>
                {network_metrics.avg_throughput} Mbps
              </div>
            </div>
            
            <div style={{ 
              backgroundColor: '#222', 
              padding: '16px', 
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>Interfaces</div>
              <div style={{ 
                fontSize: '24px', 
                color: '#66ccff', 
                fontWeight: 'bold'
              }}>
                {total_interfaces}
              </div>
            </div>
          </div>
          
          <div style={{ 
            backgroundColor: '#222', 
            padding: '16px', 
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>Network Status</div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px'
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: getStatusColor(network_metrics.status),
              }}></div>
              <span style={{
                fontSize: '16px',
                color: getStatusColor(network_metrics.status),
                fontWeight: 'bold'
              }}>
                {network_metrics.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
        
        {/* Interface Details */}
        <div>
          <h3 style={{ 
            margin: '0 0 16px 0', 
            color: '#fff', 
            fontSize: '16px',
            borderBottom: '1px solid #333',
            paddingBottom: '8px'
          }}>
            Network Interfaces
          </h3>
          
          {interfaces && interfaces.length > 0 ? (
            <div style={{ 
              maxHeight: '300px',
              overflowY: 'auto',
              borderRadius: '8px',
              border: '1px solid #333'
            }}>
              {interfaces.map((iface, index) => (
                <div 
                  key={index}
                  style={{
                    padding: '12px 16px',
                    borderBottom: index < interfaces.length - 1 ? '1px solid #333' : 'none',
                    backgroundColor: index % 2 === 0 ? '#1a1a1a' : '#222',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: '600' }}>
                      {iface.interface}
                    </div>
                    <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                      Status: <span style={{ color: getStatusColor(iface.status) }}>{iface.status.toUpperCase()}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      fontSize: '16px', 
                      color: getThroughputColor(iface.throughput),
                      fontWeight: 'bold'
                    }}>
                      {iface.throughput} {iface.units}
                    </div>
                    <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                      {Math.round(iface.utilization)}% utilization
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ 
              padding: '20px', 
              textAlign: 'center', 
              backgroundColor: '#222', 
              borderRadius: '8px',
              color: '#aaa'
            }}>
              No network interfaces found
            </div>
          )}
        </div>
        
        <button 
          onClick={onClose}
          style={{
            marginTop: '24px',
            padding: '12px 24px',
            backgroundColor: '#3B82F6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Close Network Details
        </button>
      </div>
    </div>
  );
}

/* ============================= */
/*        ALERT MODAL            */
/* ============================= */
function AlertModal({ isOpen, onClose, rackData, serverData, onNetworkDetails }) {
  if (!isOpen) return null;

  const isServer = !!serverData;
  const data = isServer ? serverData : rackData;
  const status = data?.status || {};
  
  const getAlertColor = () => {
    const overallStatus = status.overall || rackData?.status || "normal";
    if (overallStatus === "critical") return "#DC2626";
    if (overallStatus === "warning") return "#F59E0B";
    return "#10B981";
  };

  const alertColor = getAlertColor();

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#1a1a1a',
        padding: '24px',
        borderRadius: '12px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
        maxWidth: '500px',
        width: '90%',
        position: 'relative',
        border: `2px solid ${alertColor}`,
        color: '#fff',
      }}>
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: '#333',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: '#fff',
            padding: '5px 10px',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
        
        <h2 style={{ 
          margin: '0 0 20px 0', 
          color: '#fff', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px',
          fontSize: '20px',
        }}>
          <span style={{ fontSize: '24px' }}>{isServer ? '🖥️' : '🖥️🖥️🖥️'}</span>
          {isServer ? `Server ${serverData.server_name}` : `Rack ${rackData.rack_id}`}
        </h2>
        
        <div style={{ marginBottom: '20px' }}>
          <div style={{ 
            backgroundColor: '#222', 
            padding: '12px', 
            borderRadius: '8px',
            marginBottom: '12px'
          }}>
            <div style={{ fontSize: '14px', color: '#aaa' }}>Status</div>
            <div style={{ 
              fontSize: '16px', 
              color: alertColor, 
              fontWeight: '600',
              marginTop: '4px'
            }}>
              {isServer ? status.overall?.toUpperCase() : rackData.status?.toUpperCase()}
            </div>
          </div>
          
          {isServer ? (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ 
                backgroundColor: '#222', 
                padding: '12px', 
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '14px', color: '#aaa' }}>Temperature</div>
                <div style={{ 
                  fontSize: '20px', 
                  color: serverData.temperature > 65 ? '#ff6666' : '#66ff66', 
                  fontWeight: 'bold',
                  marginTop: '4px'
                }}>
                  {serverData.temperature}°C
                </div>
              </div>
              
              <div style={{ 
                backgroundColor: '#222', 
                padding: '12px', 
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '14px', color: '#aaa' }}>Power Usage</div>
                <div style={{ 
                  fontSize: '20px', 
                  color: '#66ff66', 
                  fontWeight: 'bold',
                  marginTop: '4px'
                }}>
                  {serverData.power_usage}W
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '16px'
              }}>
                <div style={{ 
                  backgroundColor: '#222', 
                  padding: '12px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '14px', color: '#aaa' }}>Temperature</div>
                  <div style={{ 
                    fontSize: '20px', 
                    color: rackData.temperature > 65 ? '#ff6666' : '#66ff66', 
                    fontWeight: 'bold',
                    marginTop: '4px'
                  }}>
                    {rackData.temperature}°C
                  </div>
                </div>
                
                <div style={{ 
                  backgroundColor: '#222', 
                  padding: '12px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '14px', color: '#aaa' }}>Power</div>
                  <div style={{ 
                    fontSize: '20px', 
                    color: '#66ff66', 
                    fontWeight: 'bold',
                    marginTop: '4px'
                  }}>
                    {rackData.power}kW
                  </div>
                </div>
              </div>
              
              {/* Network information for racks */}
              {rackData.network && rackData.network.interface_count > 0 && (
                <div style={{ 
                  backgroundColor: '#222', 
                  padding: '16px', 
                  borderRadius: '8px',
                  marginBottom: '16px',
                  borderLeft: '4px solid #3B82F6'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: '600' }}>
                      Network Information
                    </div>
                    <button 
                      onClick={() => onNetworkDetails && onNetworkDetails(rackData)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#3B82F6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      View Details
                    </button>
                  </div>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    fontSize: '12px',
                    color: '#ccc'
                  }}>
                    <div>Interfaces: <span style={{ color: '#fff' }}>{rackData.network.interface_count}</span></div>
                    <div>Avg Throughput: <span style={{ color: '#66ccff' }}>{rackData.network.avg_throughput} Mbps</span></div>
                    <div>Total Throughput: <span style={{ color: '#66ccff' }}>{rackData.network.total_throughput} Mbps</span></div>
                    <div>Status: <span style={{ 
                      color: rackData.network.status === 'critical' ? '#ef4444' : 
                             rackData.network.status === 'warning' ? '#f59e0b' : '#10b981'
                    }}>{rackData.network.status.toUpperCase()}</span></div>
                  </div>
                </div>
              )}
            </>
          )}
          
          {rackData.filename && (
            <div style={{ 
              backgroundColor: '#222', 
              padding: '12px', 
              borderRadius: '8px',
              marginBottom: '12px',
              fontSize: '12px',
              color: '#aaa'
            }}>
              <div>Data Source:</div>
              <div style={{ color: '#fff', marginTop: '4px' }}>{rackData.filename}</div>
            </div>
          )}
        </div>
        
        <button 
          onClick={onClose}
          style={{
            padding: '12px 24px',
            backgroundColor: alertColor,
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Close Details
        </button>
      </div>
    </div>
  );
}

/* ============================= */
/*          MAIN APP             */
/* ============================= */
export default function App() {
  const [viewMode, setViewMode] = useState("normal");
  const [alertOpen, setAlertOpen] = useState(false);
  const [networkDetailsOpen, setNetworkDetailsOpen] = useState(false);
  const [alertData, setAlertData] = useState(null);
  const [networkData, setNetworkData] = useState(null);
  const [datacenterStatus, setDatacenterStatus] = useState(null);
  const [networkSummary, setNetworkSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState(null);
  const [lockMouse, setLockMouse] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      setLoading(true);
      try {
        const status = await apiService.fetchDatacenterStatus();
        setDatacenterStatus(status);
        
        const network = await apiService.fetchNetworkSummary();
        setNetworkSummary(network);
        
        const debug = await apiService.debugInfo();
        setDebugInfo(debug);
      } catch (error) {
        console.error("Error fetching status:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRackClick = async (data) => {
    setAlertData(data);
    
    // If rack has network data, fetch it
    if (data.has_network_data) {
      const network = await apiService.fetchRackNetwork(data.rack_id);
      setNetworkData(network);
    }
    
    setAlertOpen(true);
  };

  const closeAlert = () => {
    setAlertOpen(false);
    setAlertData(null);
    setNetworkData(null);
  };

  const handleNetworkDetails = (rackData) => {
    setAlertOpen(false);
    setNetworkDetailsOpen(true);
  };

  const closeNetworkDetails = () => {
    setNetworkDetailsOpen(false);
    setNetworkData(null);
  };

  const handleReload = async () => {
    setLoading(true);
    const result = await apiService.reloadData();
    if (result) {
      alert(`Reloaded: ${result.message}`);
      window.location.reload();
    }
    setLoading(false);
  };

  const toggleMouseLock = () => {
    setLockMouse(!lockMouse);
    if (!lockMouse) {
      document.body.requestPointerLock();
    } else {
      document.exitPointerLock();
    }
  };

  return (
    <>
      <AlertModal 
        isOpen={alertOpen}
        onClose={closeAlert}
        rackData={alertData?.rack_id ? alertData : null}
        serverData={alertData?.server_id ? alertData : null}
        onNetworkDetails={handleNetworkDetails}
      />
      
      <NetworkDetailsModal
        isOpen={networkDetailsOpen}
        onClose={closeNetworkDetails}
        rackData={alertData}
        networkData={networkData}
      />

      {/* Control Panel */}
      <div style={{ 
        position: "absolute", 
        top: 10, 
        left: 10, 
        zIndex: 20, 
        padding: "12px 16px", 
        borderRadius: "10px", 
        background: "rgba(20, 20, 30, 0.95)", 
        display: "flex", 
        flexDirection: "column",
        gap: "12px",
        border: "1px solid rgba(80, 80, 255, 0.4)",
        maxWidth: "400px",
        backdropFilter: "blur(10px)",
      }}>
        {/* Datacenter Status */}
        <div>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            marginBottom: "8px"
          }}>
            <div style={{ color: "#fff", fontSize: "14px", fontWeight: "bold" }}>
              DATACENTER MONITOR
            </div>
            {loading ? (
              <div style={{ fontSize: "12px", color: "#aaa" }}>Loading...</div>
            ) : datacenterStatus ? (
              <div style={{ 
                fontSize: "11px", 
                color: datacenterStatus.overall_status === "critical" ? "#ef4444" :
                       datacenterStatus.overall_status === "warning" ? "#f59e0b" : "#4ade80",
                backgroundColor: datacenterStatus.overall_status === "critical" ? "rgba(239, 68, 68, 0.1)" :
                                 datacenterStatus.overall_status === "warning" ? "rgba(245, 158, 11, 0.1)" : "rgba(74, 222, 128, 0.1)",
                padding: "2px 8px",
                borderRadius: "12px"
              }}>
                {datacenterStatus.overall_status?.toUpperCase()}
              </div>
            ) : (
              <div style={{ 
                fontSize: "11px", 
                color: "#ef4444",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                padding: "2px 8px",
                borderRadius: "12px"
              }}>
                OFFLINE
              </div>
            )}
          </div>
          
          {datacenterStatus && (
            <div style={{ 
              fontSize: "12px", 
              color: "#ccc", 
              display: "grid", 
              gridTemplateColumns: "1fr 1fr", 
              gap: "4px",
              marginTop: "8px"
            }}>
              <div>Racks: <span style={{ color: "#fff" }}>{datacenterStatus.rack_count}</span></div>
              <div>Sensors: <span style={{ color: "#fff" }}>{datacenterStatus.total_sensors}</span></div>
              <div>Critical: <span style={{ color: "#ff6666" }}>{datacenterStatus.critical_racks}</span></div>
              <div>Warning: <span style={{ color: "#ffcc00" }}>{datacenterStatus.warning_racks}</span></div>
              <div>Normal: <span style={{ color: "#66ff66" }}>{datacenterStatus.normal_racks}</span></div>
              <div>Network: <span style={{ color: "#66ccff" }}>{datacenterStatus.total_network_throughput} Mbps</span></div>
            </div>
          )}
          
          {/* Network Summary */}
          {networkSummary && (
            <div style={{ 
              marginTop: "12px",
              padding: "8px",
              backgroundColor: "rgba(0, 100, 255, 0.1)",
              borderRadius: "6px",
              border: "1px solid rgba(100, 150, 255, 0.3)"
            }}>
              <div style={{ fontSize: "11px", color: "#66ccff", fontWeight: "600", marginBottom: "4px" }}>
                NETWORK SUMMARY
              </div>
              <div style={{ fontSize: "10px", color: "#aaa", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                <div>Total Throughput: <span style={{ color: "#66ccff" }}>{networkSummary.total_throughput} Mbps</span></div>
                <div>Interfaces: <span style={{ color: "#fff" }}>{networkSummary.total_interfaces}</span></div>
                <div>Racks with Network: <span style={{ color: "#fff" }}>{networkSummary.total_racks_with_network}</span></div>
                <div>Status: <span style={{ 
                  color: networkSummary.overall_status === 'critical' ? '#ef4444' : 
                         networkSummary.overall_status === 'warning' ? '#f59e0b' : '#10b981'
                }}>{networkSummary.overall_status.toUpperCase()}</span></div>
              </div>
            </div>
          )}
        </div>

        {/* View Mode Selector */}
        <div>
          <div style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", marginBottom: "8px" }}>
            VIEW MODES
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {["normal", "thermal", "power", "network", "cooling"].map((key) => (
              <button 
                key={key} 
                onClick={() => setViewMode(key)}
                style={{ 
                  padding: "8px 12px", 
                  borderRadius: "6px", 
                  border: "none", 
                  cursor: "pointer", 
                  fontSize: "11px", 
                  fontWeight: "600", 
                  background: viewMode === key ? 
                    (key === "network" ? "#3B82F6" : 
                     key === "thermal" ? "#ef4444" : 
                     key === "power" ? "#10b981" : 
                     key === "cooling" ? "#06b6d4" : "#3B82F6") : 
                    "rgba(255, 255, 255, 0.08)", 
                  color: viewMode === key ? "#fff" : "#ddd",
                  transition: "all 0.2s",
                  textTransform: "uppercase",
                  flex: "1",
                  minWidth: "60px",
                }}
              >
                {key}
              </button>
            ))}
          </div>
          
          {/* View Mode Description */}
          {viewMode === "network" && (
            <div style={{ 
              marginTop: "8px",
              padding: "8px",
              backgroundColor: "rgba(59, 130, 246, 0.1)",
              borderRadius: "6px",
              fontSize: "10px",
              color: "#66ccff"
            }}>
              Network view shows throughput and interface status. Blue indicators show network activity.
            </div>
          )}
        </div>

        {/* Controls */}
        <div>
          <div style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", marginBottom: "8px" }}>
            CONTROLS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
            <button 
              onClick={toggleMouseLock}
              style={{ 
                padding: "8px 12px", 
                borderRadius: "6px", 
                border: "none", 
                cursor: "pointer", 
                fontSize: "11px", 
                fontWeight: "600", 
                background: lockMouse ? "#3B82F6" : "rgba(255, 255, 255, 0.08)",
                color: lockMouse ? "#fff" : "#ddd",
                width: "100%"
              }}
            >
              {lockMouse ? "🔒 Mouse Locked" : "🔓 Lock Mouse"}
            </button>
            <button 
              onClick={handleReload}
              style={{ 
                padding: "8px 12px", 
                borderRadius: "6px", 
                border: "none", 
                cursor: "pointer", 
                fontSize: "11px", 
                fontWeight: "600", 
                background: "#10B981",
                color: "#fff",
                width: "100%"
              }}
            >
              ↻ Reload Data
            </button>
          </div>
          <div style={{ fontSize: "10px", color: "#888", textAlign: "center" }}>
            WASD to move • Mouse to look • Click racks for details
          </div>
        </div>
        
        {/* Debug Info */}
        {debugInfo && (
          <div style={{ 
            fontSize: "10px", 
            color: "#888", 
            marginTop: "8px",
            padding: "8px",
            background: "rgba(0,0,0,0.3)",
            borderRadius: "6px"
          }}>
            <div>Backend: {debugInfo.rack_files_count} racks, {debugInfo.current_state_count} sensors</div>
            <div>Network: {debugInfo.network_files_count} files, {debugInfo.network_files_keys?.join(', ') || 'none'}</div>
            <div>Rack IDs: {debugInfo.rack_files_keys?.join(', ')}</div>
          </div>
        )}
      </div>

      {/* 3D Scene */}
      <Canvas 
        camera={{ position: [0, 1.5, 5], fov: 75 }} 
        style={{ width: "100vw", height: "100vh", background: "#05050a" }}
        performance={{ min: 0.5 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.2} color="#1a5fb4" />
        <pointLight position={[0, 5, 0]} intensity={0.6} color="#fffff0" decay={2} distance={20} />
        <pointLight position={[0, 2, 0]} intensity={0.4} color="#ffffff" decay={1} distance={10} />
        
        <DynamicDatacenter viewMode={viewMode} onRackClick={handleRackClick} />
        <Player speed={5} />
        
        <Environment preset="city" />
        <fog attach="fog" args={['#05050a', 5, 25]} />
      </Canvas>
    </>
  );
}