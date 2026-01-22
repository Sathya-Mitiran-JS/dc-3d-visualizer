# =====================================
# FLASK BACKEND APP - WITH NETWORK DATA VISUALIZATION
# =====================================

import os
import time
import psutil
from functools import wraps
import random
import threading
import pandas as pd
import re
import json
from datetime import datetime
from collections import defaultdict
import numpy as np

from flask import Flask, jsonify, Response, request, abort, make_response
from prometheus_client import Gauge, generate_latest
from services.advanced_monitor import get_advanced_metrics

app = Flask(__name__)

# =====================================
# CORS SETUP
# =====================================

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# =====================================
# GLOBAL VARIABLES INITIALIZATION
# =====================================

gauges = {}
seen_metric_names = set()
current_state = {}
rack_files = {}
network_files = {}
rack_data = {}
rack_metadata = {}
sensor_categories = defaultdict(set)

# =====================================
# CONFIG / AUTH
# =====================================

API_KEY = os.environ.get("API_KEY", "dev-secret-key")

def require_api_key(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        client_key = request.headers.get("X-API-Key")
        if not client_key or client_key != API_KEY:
            abort(401, description="Invalid or missing API key")
        return func(*args, **kwargs)
    return wrapper

# =====================================
# DATA LOADING AND PROCESSING
# =====================================

CSV_FOLDER = "../../Data/Sensor_data"
NETWORK_FOLDER = "../../Data/Network_data"

def make_valid_prometheus_name(sensor_name: str) -> str:
    name = str(sensor_name).strip()
    name = re.sub(r'[^a-zA-Z0-9]+', '_', name)
    
    if name and name[0].isdigit():
        name = '_' + name
    
    name = re.sub(r'_+', '_', name).strip('_')
    name = name.lower()
    
    return f"sensor_{name}" if name else "sensor_unknown"

def extract_rack_number(filename):
    """Extract rack number from filename with various patterns."""
    filename_lower = filename.lower()
    
    # Try different patterns
    patterns = [
        r'rack[_\s\-]*(\d+)',
        r'r(\d+)',
        r'server[_\s\-]*(\d+)',
        r'node[_\s\-]*(\d+)',
        r'(\d+)[_\s\-]*rack',
        r'(\d+)[_\s\-]*server'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, filename_lower)
        if match:
            try:
                return int(match.group(1))
            except:
                continue
    
    # If no pattern matches, try to extract any number from filename
    numbers = re.findall(r'\d+', filename)
    if numbers:
        try:
            return int(numbers[0])  # Use first number found
        except:
            pass
    
    return None

def parse_sensor_value(value):
    """Parse sensor value, handling various formats."""
    if pd.isna(value):
        return 0.0
    
    try:
        # Try direct conversion first
        return float(value)
    except:
        # If that fails, try to extract number from string
        try:
            clean_value = str(value).strip()
            # Remove any non-numeric characters except minus, dot, and E
            match = re.search(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', clean_value)
            if match:
                return float(match.group())
            return 0.0
        except:
            return 0.0

def calculate_rack_status(sensors):
    """Calculate overall rack status from sensors - SIMPLIFIED AND FIXED."""
    critical_count = 0
    warning_count = 0
    normal_count = 0
    
    for sensor_name, sensor_data in sensors.items():
        if isinstance(sensor_data, dict):
            status = str(sensor_data.get('status', 'ok')).lower()
            
            # Check based on status column (most reliable)
            if 'critical' in status or 'non-recoverable' in status:
                critical_count += 1
            elif 'non-critical' in status or 'warning' in status:
                warning_count += 1
            elif 'ok' in status or 'normal' in status:
                normal_count += 1
            else:
                # If status is not one of the known ones, check by value
                value = sensor_data.get('value', 0)
                sensor_lower = sensor_name.lower()
                
                # Temperature sensors
                if 'temp' in sensor_lower or 'temperature' in sensor_lower:
                    if value > 85:  # Only critical at very high temps
                        critical_count += 1
                    elif value > 75:
                        warning_count += 1
                    else:
                        normal_count += 1
                else:
                    normal_count += 1
    
    # Determine overall status
    total_sensors = critical_count + warning_count + normal_count
    if total_sensors == 0:
        return "unknown"
    
    # Only mark as critical if more than 10% of sensors are critical
    if critical_count > 0 and (critical_count / total_sensors) > 0.1:
        return "critical"
    elif warning_count > 0 and (warning_count / total_sensors) > 0.2:
        return "warning"
    else:
        return "normal"

def calculate_rack_temperature(sensors):
    """Calculate average rack temperature from temperature sensors."""
    temps = []
    for sensor_name, sensor_data in sensors.items():
        if isinstance(sensor_data, dict):
            value = sensor_data.get('value', 0)
            sensor_lower = sensor_name.lower()
            
            # Only include actual temperature sensors
            if ('temp' in sensor_lower or 'temperature' in sensor_lower) and 'volt' not in sensor_lower:
                # Exclude obviously wrong values
                if -10 < value < 120:  # Reasonable temperature range
                    temps.append(value)
    
    if temps:
        # Use average of middle 50% to avoid outliers
        temps_sorted = sorted(temps)
        n = len(temps_sorted)
        start = n // 4
        end = 3 * n // 4
        middle_temps = temps_sorted[start:end] if n > 4 else temps
        return round(sum(middle_temps) / len(middle_temps), 1)
    return 40.0  # Default

def calculate_rack_power(sensors):
    """Calculate estimated rack power consumption."""
    power_values = []
    
    for sensor_name, sensor_data in sensors.items():
        if isinstance(sensor_data, dict):
            value = sensor_data.get('value', 0)
            sensor_lower = sensor_name.lower()
            
            # Look for power-related sensors
            if any(term in sensor_lower for term in ['power', 'watt', 'current', 'amp']):
                power_values.append(value)
    
    if power_values:
        total_power = sum(power_values)
        # Convert to kW if in watts (most rack power is in kW)
        if total_power > 10000:  # If over 10,000, assume it's in watts
            return round(total_power / 1000, 2)
        return round(total_power, 2)
    
    # Default based on number of temperature sensors (indicator of server count)
    temp_sensors = len([k for k, v in sensors.items() 
                       if isinstance(v, dict) and ('temp' in k.lower() or 'temperature' in k.lower())])
    return round(1.0 + (temp_sensors * 0.05), 2)  # Base + per temperature sensor

def calculate_network_metrics(network_data):
    """Calculate network metrics from network data."""
    if not network_data:
        return {
            'total_throughput': 0,
            'avg_throughput': 0,
            'max_throughput': 0,
            'interface_count': 0,
            'status': 'normal'
        }
    
    throughput_values = []
    for interface, data in network_data.items():
        if isinstance(data, dict):
            throughput_values.append(data.get('value', 0))
    
    if throughput_values:
        total_throughput = sum(throughput_values)
        avg_throughput = total_throughput / len(throughput_values)
        max_throughput = max(throughput_values)
        
        # Determine network status
        if max_throughput > 95:
            network_status = 'critical'
        elif max_throughput > 85:
            network_status = 'warning'
        else:
            network_status = 'normal'
        
        return {
            'total_throughput': round(total_throughput, 2),
            'avg_throughput': round(avg_throughput, 2),
            'max_throughput': round(max_throughput, 2),
            'interface_count': len(throughput_values),
            'status': network_status
        }
    
    return {
        'total_throughput': 0,
        'avg_throughput': 0,
        'max_throughput': 0,
        'interface_count': 0,
        'status': 'normal'
    }

def load_network_data():
    """Load network data files."""
    if not os.path.exists(NETWORK_FOLDER):
        print(f"Warning: Network folder does not exist: {NETWORK_FOLDER}")
        return {}
    
    network_files = {}
    csv_files = [f for f in os.listdir(NETWORK_FOLDER) if f.endswith('.csv')]
    print(f"Found {len(csv_files)} network CSV files")
    
    for filename in csv_files:
        try:
            rack_id = extract_rack_number(filename)
            if rack_id is None:
                print(f"Warning: Could not extract rack number from network file: {filename}")
                continue
            
            path = os.path.join(NETWORK_FOLDER, filename)
            try:
                df = pd.read_csv(path)
            except UnicodeDecodeError:
                df = pd.read_csv(path, encoding='latin-1')
            
            print(f"\nLoading network data for rack {rack_id}: {filename}")
            print(f"Network file shape: {df.shape}")
            print(f"Network file columns: {list(df.columns)}")
            
            # Store network data
            network_data = {}
            interface_count = 0
            
            # Try to parse network data - handle different formats
            for _, row in df.iterrows():
                interface_name = None
                throughput_value = 0
                
                # Find interface/port name
                for col in df.columns:
                    col_lower = col.lower()
                    if any(term in col_lower for term in ['interface', 'port', 'nic', 'network', 'name']):
                        if not pd.isna(row[col]):
                            interface_name = str(row[col]).strip()
                            break
                
                if not interface_name:
                    continue
                
                # Find throughput/bandwidth value
                for col in df.columns:
                    col_lower = col.lower()
                    if any(term in col_lower for term in ['throughput', 'bandwidth', 'speed', 'rate', 'utilization', 'value', 'mbps', 'gbps']):
                        if not pd.isna(row[col]):
                            throughput_value = parse_sensor_value(row[col])
                            break
                
                # If no throughput found, try any numeric column
                if throughput_value == 0:
                    for col in df.columns:
                        if col != 'Interface' and col != 'Port' and col != 'Name':
                            try:
                                val = parse_sensor_value(row[col])
                                if val > 0:
                                    throughput_value = val
                                    break
                            except:
                                continue
                
                if throughput_value > 0:
                    # Determine status based on throughput
                    if throughput_value > 95:
                        status = 'critical'
                    elif throughput_value > 85:
                        status = 'warning'
                    else:
                        status = 'ok'
                    
                    network_data[interface_name] = {
                        'value': throughput_value,
                        'status': status,
                        'units': 'Mbps'
                    }
                    interface_count += 1
            
            # If no data parsed, create sample network data
            if not network_data:
                print(f"Creating sample network data for rack {rack_id}")
                for i in range(1, 5):
                    throughput = random.uniform(10, 80)
                    network_data[f"eth{i}"] = {
                        'value': round(throughput, 2),
                        'status': 'ok' if throughput < 85 else 'warning' if throughput < 95 else 'critical',
                        'units': 'Mbps'
                    }
                interface_count = 4
            
            network_files[rack_id] = {
                'filename': filename,
                'data': network_data,
                'dataframe': df,
                'interface_count': interface_count,
                'metrics': calculate_network_metrics(network_data)
            }
            
            print(f"Loaded {interface_count} network interfaces for rack {rack_id}")
            print(f"Network metrics: {network_files[rack_id]['metrics']}")
            
        except Exception as e:
            print(f"Error loading network file {filename}: {str(e)}")
            import traceback
            traceback.print_exc()
    
    return network_files

def update_rack_data():
    """Update rack data from current CSV and network data."""
    global rack_data, rack_metadata, current_state
    
    # Load network data
    network_data = load_network_data()
    
    for rack_id, rack_info in rack_files.items():
        df = rack_info['dataframe']
        
        sensors_dict = {}
        sensor_count = 0
        
        # Process each row in the CSV
        for _, row in df.iterrows():
            sensor_name = None
            sensor_value = 0
            sensor_status = 'ok'
            sensor_units = ''
            
            # Find Sensor column
            for col in df.columns:
                col_lower = col.lower()
                if 'sensor' in col_lower or 'name' in col_lower:
                    sensor_name = str(row[col]).strip()
                    break
            
            if not sensor_name or pd.isna(sensor_name) or sensor_name == '':
                continue
            
            # Find Value column
            value_found = False
            for col in df.columns:
                col_lower = col.lower()
                if 'value' in col_lower or 'reading' in col_lower:
                    sensor_value = parse_sensor_value(row[col])
                    value_found = True
                    break
            
            # If no Value column, try to find numeric columns
            if not value_found:
                for col in df.columns:
                    if col != 'Sensor' and col != 'Status' and col != 'Units':
                        try:
                            sensor_value = parse_sensor_value(row[col])
                            value_found = True
                            break
                        except:
                            continue
            
            # Find Status column
            status_found = False
            for col in df.columns:
                col_lower = col.lower()
                if 'status' in col_lower:
                    raw_status = row[col]
                    if not pd.isna(raw_status):
                        sensor_status = str(raw_status).strip()
                        status_found = True
                    break
            
            # If no Status column, determine status from value
            if not status_found:
                sensor_lower = sensor_name.lower()
                if 'temp' in sensor_lower:
                    if sensor_value > 85:
                        sensor_status = 'critical'
                    elif sensor_value > 75:
                        sensor_status = 'warning'
                    else:
                        sensor_status = 'ok'
                else:
                    sensor_status = 'ok'
            
            # Find Units column
            for col in df.columns:
                col_lower = col.lower()
                if 'unit' in col_lower:
                    raw_units = row[col]
                    if not pd.isna(raw_units):
                        sensor_units = str(raw_units).strip()
                    break
            
            sensors_dict[sensor_name] = {
                'value': sensor_value,
                'status': sensor_status,
                'units': sensor_units,
                'raw_value': str(sensor_value),
                'type': 'sensor'
            }
            sensor_count += 1
            
            # Create gauge if it doesn't exist
            if sensor_name not in gauges:
                metric_name = make_valid_prometheus_name(sensor_name)
                base_name = metric_name
                counter = 1
                while metric_name in seen_metric_names:
                    metric_name = f"{base_name}_{counter}"
                    counter += 1
                
                gauges[sensor_name] = Gauge(metric_name, f"Sensor reading: {sensor_name}")
                seen_metric_names.add(metric_name)
            
            # Update current state
            current_state[sensor_name] = sensor_value
        
        # Add network data if available
        network_metrics = {
            'total_throughput': 0,
            'avg_throughput': 0,
            'max_throughput': 0,
            'interface_count': 0,
            'status': 'normal'
        }
        
        if rack_id in network_data:
            net_info = network_data[rack_id]
            network_metrics = net_info['metrics']
            
            for interface, net_data in net_info['data'].items():
                net_sensor_name = f"Network_{interface}"
                sensors_dict[net_sensor_name] = {
                    'value': net_data['value'],
                    'status': net_data['status'],
                    'units': net_data.get('units', 'Mbps'),
                    'raw_value': str(net_data['value']),
                    'type': 'network',
                    'interface': interface
                }
                sensor_count += 1
        
        if sensors_dict:
            # Calculate status with debug info
            status = calculate_rack_status(sensors_dict)
            
            rack_data[rack_id] = {
                'sensors': sensors_dict,
                'status': status,
                'temperature': calculate_rack_temperature(sensors_dict),
                'power': calculate_rack_power(sensors_dict),
                'network': network_metrics,
                'sensor_count': sensor_count,
                'timestamp': time.strftime("%Y-%m-%d %H:%M:%S")
            }
            
            # Categorize sensors
            temp_count = 0
            power_count = 0
            network_count = 0
            cooling_count = 0
            
            for sensor_name, sensor_data in sensors_dict.items():
                sensor_lower = sensor_name.lower()
                if any(term in sensor_lower for term in ['temp', 'temperature', 'thermal']) and 'volt' not in sensor_lower:
                    temp_count += 1
                    sensor_categories['temperature'].add(sensor_name)
                elif any(term in sensor_lower for term in ['power', 'watt', 'volt', 'current', 'vrm', 'vbat', 'vcc', 'vcpu', 'vdimm']):
                    power_count += 1
                    sensor_categories['power'].add(sensor_name)
                elif any(term in sensor_lower for term in ['cpu', 'processor', 'core']):
                    sensor_categories['cpu'].add(sensor_name)
                elif any(term in sensor_lower for term in ['memory', 'ram', 'swap', 'dimm']):
                    sensor_categories['memory'].add(sensor_name)
                elif any(term in sensor_lower for term in ['fan', 'rpm', 'cooling', 'airflow']):
                    cooling_count += 1
                    sensor_categories['cooling'].add(sensor_name)
                elif sensor_data.get('type') == 'network' or any(term in sensor_lower for term in ['network', 'interface', 'port', 'nic', 'throughput', 'bandwidth']):
                    network_count += 1
                    sensor_categories['network'].add(sensor_name)
                elif any(term in sensor_lower for term in ['disk', 'storage', 'io', 'read', 'write', 'hdd', 'sas']):
                    sensor_categories['disk'].add(sensor_name)
                elif any(term in sensor_lower for term in ['humidity', 'moisture']):
                    sensor_categories['environment'].add(sensor_name)
                else:
                    sensor_categories['other'].add(sensor_name)
            
            rack_metadata[rack_id] = {
                'filename': rack_info['filename'],
                'sensor_categories': {
                    'temperature': temp_count,
                    'power': power_count,
                    'network': network_count,
                    'cooling': cooling_count,
                    'total': sensor_count
                }
            }

def load_rack_data():
    """Load all CSV files and organize them as racks."""
    global rack_files, sensor_categories
    
    rack_files.clear()
    rack_data.clear()
    rack_metadata.clear()
    sensor_categories.clear()
    
    print(f"\n{'='*60}")
    print(f"Loading sensor CSV files from: {CSV_FOLDER}")
    print(f"{'='*60}")
    
    if not os.path.exists(CSV_FOLDER):
        print(f"Warning: Sensor folder does not exist: {CSV_FOLDER}")
        create_sample_racks()
        return
    
    csv_files = [f for f in os.listdir(CSV_FOLDER) if f.endswith('.csv')]
    print(f"Found {len(csv_files)} sensor CSV files")
    
    if len(csv_files) == 0:
        print("No CSV files found. Creating sample racks...")
        create_sample_racks()
        return
    
    # First pass: extract all rack numbers
    rack_numbers = {}
    for filename in csv_files:
        rack_id = extract_rack_number(filename)
        if rack_id:
            if rack_id not in rack_numbers:
                rack_numbers[rack_id] = []
            rack_numbers[rack_id].append(filename)
            print(f"File '{filename}' assigned to rack {rack_id}")
        else:
            print(f"Warning: Could not extract rack number from: {filename}")
    
    print(f"\nFound racks: {sorted(rack_numbers.keys())}")
    
    # Second pass: load files for each rack
    for rack_id, filenames in rack_numbers.items():
        # Use the first file for this rack
        filename = filenames[0]
        try:
            path = os.path.join(CSV_FOLDER, filename)
            
            # Read CSV with proper encoding
            try:
                df = pd.read_csv(path)
            except UnicodeDecodeError:
                df = pd.read_csv(path, encoding='latin-1')
            
            print(f"\nRack {rack_id}: {filename}")
            print(f"  Shape: {df.shape}")
            print(f"  Columns: {list(df.columns)}")
            
            # Store the raw data
            rack_files[rack_id] = {
                'filename': filename,
                'path': path,
                'dataframe': df,
                'all_files': filenames
            }
            
        except Exception as e:
            print(f"Error loading file {filename} for rack {rack_id}: {str(e)}")
            import traceback
            traceback.print_exc()
    
    update_rack_data()
    print(f"\n{'='*60}")
    print(f"Loaded {len(rack_files)} racks from CSV files")
    print(f"Total sensors: {len(current_state)}")
    print(f"{'='*60}")

def create_sample_racks():
    """Create sample racks for testing if no CSV files found."""
    print("Creating 5 sample racks with network data for testing...")
    
    sample_sensors = [
        "CPU1 Temp", "CPU2 Temp", "System Temp", 
        "FAN1", "FAN2", "12V", "5VCC", "3.3VCC",
        "P1-DIMMA1 Temp", "Vcpu1"
    ]
    
    for rack_id in range(1, 6):
        sensors_dict = {}
        
        for sensor in sample_sensors:
            # Generate realistic values
            if 'Temp' in sensor:
                base_temp = 40 + random.uniform(-5, 10)
                if 'CPU' in sensor:
                    value = base_temp + random.uniform(5, 20)
                    status = 'ok' if value < 70 else 'warning' if value < 80 else 'critical'
                else:
                    value = base_temp + random.uniform(-5, 5)
                    status = 'ok'
                units = 'degrees C'
            elif 'FAN' in sensor:
                value = random.uniform(1000, 3000)
                status = 'ok'
                units = 'RPM'
            elif 'V' in sensor:
                if '12V' in sensor:
                    value = random.uniform(11.9, 12.1)
                elif '5V' in sensor:
                    value = random.uniform(4.95, 5.05)
                elif '3.3V' in sensor:
                    value = random.uniform(3.28, 3.32)
                else:
                    value = random.uniform(1.0, 1.5)
                status = 'ok'
                units = 'Volts'
            else:
                value = random.uniform(20, 40)
                status = 'ok'
                units = 'degrees C'
            
            sensors_dict[sensor] = {
                'value': round(value, 3),
                'status': status,
                'units': units,
                'raw_value': str(round(value, 3)),
                'type': 'sensor'
            }
        
        # Create sample network data
        network_data = {}
        for i in range(1, 5):
            throughput = random.uniform(10, 80)
            network_data[f"eth{i}"] = {
                'value': round(throughput, 2),
                'status': 'ok' if throughput < 85 else 'warning' if throughput < 95 else 'critical',
                'units': 'Mbps'
            }
        
        # Create a dummy dataframe
        df = pd.DataFrame({
            'Sensor': list(sensors_dict.keys()),
            'Value': [s['value'] for s in sensors_dict.values()],
            'Units': [s['units'] for s in sensors_dict.values()],
            'Status': [s['status'] for s in sensors_dict.values()]
        })
        
        rack_files[rack_id] = {
            'filename': f'sample_rack_{rack_id}.csv',
            'path': f'sample/path/rack_{rack_id}.csv',
            'dataframe': df,
            'all_files': [f'sample_rack_{rack_id}.csv']
        }
    
    update_rack_data()
    print(f"Created {len(rack_files)} sample racks with network data")

# Initialize data loading
load_rack_data()

# =====================================
# PROMETHEUS METRICS
# =====================================

cpu_gauge = Gauge("system_cpu_percent", "CPU usage percentage")
mem_gauge = Gauge("system_memory_percent", "Memory usage percentage")
disk_gauge = Gauge("system_disk_usage", "Disk usage percentage")

cpu_load_1 = Gauge("cpu_load_1min", "1-minute load average")
cpu_load_5 = Gauge("cpu_load_5min", "5-minute load average")
cpu_load_15 = Gauge("cpu_load_15min", "15-minute load average")

mem_available = Gauge("memory_available_bytes", "Available memory in bytes")
disk_read_bytes = Gauge("disk_read_bytes_total", "Total disk read bytes")
disk_write_bytes = Gauge("disk_write_bytes_total", "Total disk written bytes")
net_bytes_sent = Gauge("network_bytes_sent_total", "Network bytes sent")
net_bytes_recv = Gauge("network_bytes_recv_total", "Network bytes received")

def data_update_loop():
    while True:
        try:
            load_rack_data()
            print(f"Updated rack data at {time.strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"Current racks: {sorted(rack_files.keys())}")
        except Exception as e:
            print(f"Error updating rack data: {str(e)}")
            import traceback
            traceback.print_exc()
        time.sleep(30)

threading.Thread(target=data_update_loop, daemon=True).start()

# =====================================
# API ENDPOINTS
# =====================================

@app.route("/api/metrics/detail", methods=["GET"])
def get_detailed_metrics():
    data = get_advanced_metrics()
    return jsonify(data)

@app.route("/api/metrics/status", methods=["GET"])
def get_status():
    simple_state = {}
    for sensor, value in current_state.items():
        simple_state[sensor] = value
    
    return jsonify({
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "racks": len(rack_files),
        "total_sensors": len(current_state),
        "current_state": simple_state
    })

@app.route("/metrics", methods=["GET"])
def metrics():
    cpu_gauge.set(psutil.cpu_percent())
    mem_gauge.set(psutil.virtual_memory().percent)
    disk_gauge.set(psutil.disk_usage("/").percent)
    
    if hasattr(psutil, 'getloadavg'):
        try:
            load_avg = psutil.getloadavg()
            cpu_load_1.set(load_avg[0])
            cpu_load_5.set(load_avg[1])
            cpu_load_15.set(load_avg[2])
        except:
            cpu_load_1.set(0)
            cpu_load_5.set(0)
            cpu_load_15.set(0)
    else:
        cpu_load_1.set(0)
        cpu_load_5.set(0)
        cpu_load_15.set(0)
    
    mem = psutil.virtual_memory()
    mem_available.set(mem.available)
    
    for sensor, gauge in gauges.items():
        gauge.set(current_state.get(sensor, 0.0))
    
    return Response(generate_latest(), mimetype="text/plain")

@app.route("/api/racks", methods=["GET"])
def get_all_racks():
    """Returns list of all racks with metadata including network data."""
    racks_list = []
    for rack_id in sorted(rack_files.keys()):
        if rack_id in rack_metadata:
            rack_info = rack_data.get(rack_id, {})
            
            racks_list.append({
                "rack_id": rack_id,
                "filename": rack_metadata[rack_id]['filename'],
                "all_files": rack_files[rack_id].get('all_files', []),
                "sensor_categories": rack_metadata[rack_id]['sensor_categories'],
                "status": rack_info.get('status', 'unknown'),
                "temperature": rack_info.get('temperature', 0),
                "power": rack_info.get('power', 0),
                "network": rack_info.get('network', {}),
                "sensor_count": rack_info.get('sensor_count', 0),
                "has_network_data": rack_info.get('network', {}).get('interface_count', 0) > 0
            })
    
    return jsonify({
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_racks": len(racks_list),
        "racks": racks_list
    })

@app.route("/api/rack/<int:rack_id>", methods=["GET"])
def get_rack_metrics(rack_id):
    if rack_id not in rack_data:
        return jsonify({
            "error": f"Rack {rack_id} not found",
            "available_racks": sorted(rack_data.keys())
        }), 404
    
    rack_info = rack_data[rack_id]
    rack_meta = rack_metadata.get(rack_id, {})
    
    # Get network interfaces
    network_interfaces = []
    for sensor_name, sensor_data in rack_info['sensors'].items():
        if sensor_data.get('type') == 'network':
            network_interfaces.append({
                'name': sensor_name,
                'interface': sensor_data.get('interface', sensor_name),
                'throughput': sensor_data.get('value', 0),
                'status': sensor_data.get('status', 'ok'),
                'units': sensor_data.get('units', 'Mbps')
            })
    
    sensors_by_category = {}
    for category, sensor_names in sensor_categories.items():
        category_sensors = {}
        for sensor in sensor_names:
            if sensor in rack_info['sensors']:
                category_sensors[sensor] = rack_info['sensors'][sensor]
        if category_sensors:
            sensors_by_category[category] = category_sensors
    
    return jsonify({
        "rack_id": rack_id,
        "filename": rack_meta.get('filename', 'unknown'),
        "all_files": rack_files.get(rack_id, {}).get('all_files', []),
        "timestamp": rack_info.get('timestamp', time.strftime("%Y-%m-%d %H:%M:%S")),
        "status": rack_info['status'],
        "temperature": rack_info['temperature'],
        "power": rack_info['power'],
        "network": {
            **rack_info.get('network', {}),
            'interfaces': network_interfaces
        },
        "sensor_count": rack_info['sensor_count'],
        "sensors": rack_info['sensors'],
        "sensors_by_category": sensors_by_category,
        "sensor_summary": rack_meta.get('sensor_categories', {})
    })

@app.route("/api/rack/<int:rack_id>/network", methods=["GET"])
def get_rack_network(rack_id):
    """Get detailed network data for a specific rack."""
    if rack_id not in rack_data:
        return jsonify({
            "error": f"Rack {rack_id} not found",
            "available_racks": sorted(rack_data.keys())
        }), 404
    
    rack_info = rack_data[rack_id]
    
    # Extract network data
    network_interfaces = []
    network_sensors = []
    
    for sensor_name, sensor_data in rack_info['sensors'].items():
        if sensor_data.get('type') == 'network' or 'network' in sensor_name.lower():
            network_sensors.append({
                'name': sensor_name,
                **sensor_data
            })
            
            if sensor_data.get('type') == 'network':
                network_interfaces.append({
                    'interface': sensor_data.get('interface', sensor_name),
                    'throughput': sensor_data.get('value', 0),
                    'status': sensor_data.get('status', 'ok'),
                    'units': sensor_data.get('units', 'Mbps'),
                    'utilization': min(100, sensor_data.get('value', 0))  # Assuming Mbps, cap at 100%
                })
    
    return jsonify({
        "rack_id": rack_id,
        "network_metrics": rack_info.get('network', {}),
        "interfaces": network_interfaces,
        "network_sensors": network_sensors,
        "total_interfaces": len(network_interfaces),
        "timestamp": rack_info.get('timestamp', time.strftime("%Y-%m-%d %H:%M:%S"))
    })

@app.route("/api/network/summary", methods=["GET"])
def get_network_summary():
    """Get network summary across all racks."""
    all_network_data = []
    total_throughput = 0
    total_interfaces = 0
    network_critical = 0
    network_warning = 0
    network_normal = 0
    
    for rack_id in sorted(rack_data.keys()):
        rack_info = rack_data[rack_id]
        network_info = rack_info.get('network', {})
        
        if network_info.get('interface_count', 0) > 0:
            all_network_data.append({
                "rack_id": rack_id,
                **network_info
            })
            
            total_throughput += network_info.get('total_throughput', 0)
            total_interfaces += network_info.get('interface_count', 0)
            
            if network_info.get('status') == 'critical':
                network_critical += 1
            elif network_info.get('status') == 'warning':
                network_warning += 1
            else:
                network_normal += 1
    
    overall_network_status = "critical" if network_critical > 0 else "warning" if network_warning > 0 else "normal"
    
    return jsonify({
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "overall_status": overall_network_status,
        "total_racks_with_network": len(all_network_data),
        "total_interfaces": total_interfaces,
        "total_throughput": round(total_throughput, 2),
        "rack_status": {
            "critical": network_critical,
            "warning": network_warning,
            "normal": network_normal
        },
        "racks": all_network_data
    })

@app.route("/api/rack/<int:rack_id>/servers", methods=["GET"])
def get_rack_servers(rack_id):
    if rack_id not in rack_data:
        return jsonify({
            "error": f"Rack {rack_id} not found",
            "available_racks": sorted(rack_data.keys())
        }), 404
    
    rack_info = rack_data[rack_id]
    
    # Count CPU temperature sensors to determine server count
    cpu_sensors = [k for k in rack_info['sensors'].keys() 
                  if any(term in k.lower() for term in ['cpu']) and 'temp' in k.lower()]
    
    # If no CPU sensors found, count by pattern
    if not cpu_sensors:
        for sensor_name in rack_info['sensors'].keys():
            if re.search(r'cpu\d+', sensor_name.lower()):
                cpu_sensors.append(sensor_name)
    
    server_count = max(1, len(cpu_sensors) if cpu_sensors else 2)
    
    servers = []
    for server_id in range(1, server_count + 1):
        server_data = generate_server_from_sensors(rack_id, server_id, rack_info['sensors'])
        servers.append(server_data)
    
    return jsonify({
        "rack_id": rack_id,
        "server_count": server_count,
        "servers": servers
    })

@app.route("/api/rack/<int:rack_id>/server/<int:server_id>", methods=["GET"])
def get_server_metrics(rack_id, server_id):
    if rack_id not in rack_data:
        return jsonify({"error": f"Rack {rack_id} not found"}), 404
    
    rack_info = rack_data[rack_id]
    
    cpu_sensors = [k for k in rack_info['sensors'].keys() 
                  if any(term in k.lower() for term in ['cpu']) and 'temp' in k.lower()]
    
    max_servers = max(1, len(cpu_sensors) if cpu_sensors else 2)
    
    if server_id < 1 or server_id > max_servers:
        return jsonify({"error": f"Server {server_id} not found in rack {rack_id}"}), 404
    
    server_data = generate_server_from_sensors(rack_id, server_id, rack_info['sensors'])
    
    return jsonify(server_data)

def generate_server_from_sensors(rack_id, server_id, rack_sensors):
    # Find CPU temperature for this server
    cpu_temp = None
    cpu_patterns = [f'CPU{server_id}', f'CPU {server_id}', f'P{server_id}']
    
    for sensor_name, sensor_data in rack_sensors.items():
        sensor_lower = sensor_name.lower()
        for pattern in cpu_patterns:
            if pattern.lower() in sensor_lower and 'temp' in sensor_lower:
                cpu_temp = sensor_data.get('value', 0)
                break
        if cpu_temp is not None:
            break
    
    # If no specific CPU temp found, use average
    if cpu_temp is None:
        cpu_temps = [v['value'] for k, v in rack_sensors.items() 
                    if 'cpu' in k.lower() and 'temp' in k.lower()]
        if cpu_temps and server_id <= len(cpu_temps):
            cpu_temp = cpu_temps[server_id - 1]
        else:
            rack_temp = calculate_rack_temperature(rack_sensors)
            position_factor = (server_id - 1) / 10
            cpu_temp = rack_temp + (position_factor * 5) - 2.5
    
    # Determine thermal status - MORE FORGIVING
    if cpu_temp > 85:
        thermal_status = "critical"
    elif cpu_temp > 75:
        thermal_status = "warning"
    elif cpu_temp < 20:
        thermal_status = "cold"
    else:
        thermal_status = "normal"
    
    # Power status - MOSTLY NORMAL
    power_status = "normal"
    power_values = [v['value'] for k, v in rack_sensors.items() 
                   if any(term in k.lower() for term in ['power', 'watt'])]
    
    if power_values:
        avg_power = sum(power_values) / len(power_values)
        if avg_power > 1000:  # Very high threshold
            power_status = "critical"
        elif avg_power > 800:
            power_status = "warning"
    
    # Network status - Use network data if available
    network_status = "normal"
    network_usage = 50  # Default
    
    # Find network throughput for this server (simulated)
    network_values = [v['value'] for k, v in rack_sensors.items() 
                     if v.get('type') == 'network']
    
    if network_values:
        # Distribute network load across servers
        total_network = sum(network_values)
        server_count = max(1, len([k for k in rack_sensors.keys() if 'cpu' in k.lower() and 'temp' in k.lower()]))
        network_usage = min(100, (total_network / server_count) * (server_id / server_count))
        
        if network_usage > 95:
            network_status = "critical"
        elif network_usage > 85:
            network_status = "warning"
    
    # Cooling status
    cooling_status = "normal"
    if cpu_temp > 75:
        cooling_status = "insufficient"
    elif cpu_temp < 25:
        cooling_status = "excessive"
    
    # Overall status - Only critical if thermal is critical
    overall_status = "critical" if thermal_status == "critical" \
                    else "warning" if thermal_status == "warning" \
                    else "normal"
    
    # Calculate usage percentages
    cpu_usage = min(100, max(0, (cpu_temp - 30) * 1.5))
    memory_usage = 40 + random.uniform(-10, 20)
    
    return {
        "rack_id": rack_id,
        "server_id": server_id,
        "server_name": f"Rack{rack_id}_Server{server_id}",
        "temperature": round(cpu_temp, 1),
        "power_usage": round(300 + random.uniform(-50, 100), 0),
        "cpu_usage": round(cpu_usage, 1),
        "memory_usage": round(memory_usage, 1),
        "network_usage": round(network_usage, 1),
        "status": {
            "thermal": thermal_status,
            "power": power_status,
            "network": network_status,
            "cooling": cooling_status,
            "overall": overall_status
        },
        "position": {
            "u_position": server_id,
            "slot": f"U{server_id}"
        }
    }

@app.route("/api/datacenter/status", methods=["GET"])
def get_datacenter_status():
    racks_status = {}
    critical_count = 0
    warning_count = 0
    normal_count = 0
    total_temperature = 0
    total_power = 0
    total_network_throughput = 0
    rack_count = 0
    
    for rack_id in sorted(rack_data.keys()):
        rack_info = rack_data[rack_id]
        racks_status[f"rack_{rack_id}"] = {
            "rack_id": rack_id,
            "status": rack_info['status'],
            "temperature": rack_info['temperature'],
            "power": rack_info['power'],
            "network": rack_info.get('network', {}),
            "sensor_count": rack_info['sensor_count'],
            "filename": rack_metadata.get(rack_id, {}).get('filename', 'unknown')
        }
        
        if rack_info['status'] == 'critical':
            critical_count += 1
        elif rack_info['status'] == 'warning':
            warning_count += 1
        else:
            normal_count += 1
        
        total_temperature += rack_info['temperature']
        total_power += rack_info['power']
        total_network_throughput += rack_info.get('network', {}).get('total_throughput', 0)
        rack_count += 1
    
    avg_temperature = total_temperature / rack_count if rack_count > 0 else 0
    avg_power = total_power / rack_count if rack_count > 0 else 0
    avg_network_throughput = total_network_throughput / rack_count if rack_count > 0 else 0
    
    # Overall status - Only critical if more than 20% racks are critical
    overall_status = "normal"
    if critical_count > 0 and (critical_count / rack_count) > 0.2:
        overall_status = "critical"
    elif warning_count > 0 and (warning_count / rack_count) > 0.3:
        overall_status = "warning"
    
    return jsonify({
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "overall_status": overall_status,
        "rack_count": rack_count,
        "critical_racks": critical_count,
        "warning_racks": warning_count,
        "normal_racks": normal_count,
        "average_temperature": round(avg_temperature, 1),
        "average_power": round(avg_power, 1),
        "total_network_throughput": round(total_network_throughput, 2),
        "average_network_throughput": round(avg_network_throughput, 2),
        "total_sensors": len(current_state),
        "racks": racks_status
    })

@app.route("/api/sensors/categories", methods=["GET"])
def get_sensor_categories():
    category_counts = {}
    for category, sensors in sensor_categories.items():
        category_counts[category] = len(sensors)
    
    return jsonify({
        "categories": category_counts,
        "total_sensors": sum(category_counts.values())
    })

@app.route("/api/reload", methods=["POST"])
def reload_data():
    try:
        load_rack_data()
        return jsonify({
            "status": "success",
            "message": f"Reloaded {len(rack_files)} racks with {len(current_state)} sensors",
            "racks": sorted(rack_files.keys()),
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route("/api/debug", methods=["GET"])
def debug_info():
    network_data = load_network_data()
    return jsonify({
        "rack_files_count": len(rack_files),
        "rack_files_keys": sorted(rack_files.keys()),
        "rack_data_count": len(rack_data),
        "rack_data_keys": sorted(rack_data.keys()),
        "current_state_count": len(current_state),
        "network_files_count": len(network_data),
        "network_files_keys": sorted(network_data.keys()),
        "sensor_categories": {k: len(v) for k, v in sensor_categories.items()},
        "csv_folder": CSV_FOLDER,
        "csv_folder_exists": os.path.exists(CSV_FOLDER),
        "network_folder": NETWORK_FOLDER,
        "network_folder_exists": os.path.exists(NETWORK_FOLDER),
        "sample_racks": len([f for f in rack_files.values() if 'sample' in f.get('filename', '')])
    })

@app.route("/api/debug/rack/<int:rack_id>/status", methods=["GET"])
def debug_rack_status(rack_id):
    """Debug endpoint to see why a rack has a particular status."""
    if rack_id not in rack_data:
        return jsonify({"error": f"Rack {rack_id} not found"}), 404
    
    rack_info = rack_data[rack_id]
    
    critical_sensors = []
    warning_sensors = []
    normal_sensors = []
    
    for sensor_name, sensor_data in rack_info['sensors'].items():
        status = str(sensor_data.get('status', 'ok')).lower()
        if 'critical' in status or 'non-recoverable' in status:
            critical_sensors.append({
                'name': sensor_name,
                'value': sensor_data.get('value', 0),
                'status': sensor_data.get('status', 'ok'),
                'type': sensor_data.get('type', 'sensor')
            })
        elif 'non-critical' in status or 'warning' in status:
            warning_sensors.append({
                'name': sensor_name,
                'value': sensor_data.get('value', 0),
                'status': sensor_data.get('status', 'ok'),
                'type': sensor_data.get('type', 'sensor')
            })
        else:
            normal_sensors.append({
                'name': sensor_name,
                'value': sensor_data.get('value', 0),
                'status': sensor_data.get('status', 'ok'),
                'type': sensor_data.get('type', 'sensor')
            })
    
    return jsonify({
        "rack_id": rack_id,
        "overall_status": rack_info['status'],
        "critical_sensors": critical_sensors,
        "warning_sensors": warning_sensors,
        "normal_sensors": normal_sensors[:10],  # First 10 normal sensors
        "total_sensors": len(rack_info['sensors']),
        "network_data": rack_info.get('network', {})
    })

# =====================================
# CONTROL / MANAGEMENT ENDPOINTS
# =====================================

@app.route("/api/control/ping", methods=["GET"])
@require_api_key
def control_ping():
    return jsonify({"status": "ok", "message": "Control API is reachable and authenticated"})

# =====================================
# GRAFANA APIS
# =====================================

DASHBOARD_UIDS = {
    "thermal": "ad8xbxx",
    "power": "ad6dpw6",
    "cooling": "ad7nfrb",
    "network": "ad8xnet"  # Added network dashboard
}

@app.route('/api/dashboards', methods=["GET"])
def get_dashboards():
    return jsonify(DASHBOARD_UIDS)

# =====================================
# MAIN ENTRY POINT
# =====================================

if __name__ == "__main__":
    print(f"\n{'='*60}")
    print(f"Starting Flask server on port 10000")
    print(f"{'='*60}")
    
    # Print initial status of all racks
    print(f"\nInitial Rack Status Summary:")
    print(f"{'='*60}")
    for rack_id in sorted(rack_data.keys()):
        rack_info = rack_data[rack_id]
        network_info = rack_info.get('network', {})
        print(f"Rack {rack_id}: {rack_info['status']} (Temp: {rack_info['temperature']}°C, Power: {rack_info['power']}kW, Network: {network_info.get('interface_count', 0)} interfaces)")
    
    print(f"\n{'='*60}")
    print(f"Available endpoints:")
    print(f"  GET  /api/racks                    - List all racks with network data")
    print(f"  GET  /api/rack/<id>                - Get specific rack data")
    print(f"  GET  /api/rack/<id>/network        - Get detailed network data")
    print(f"  GET  /api/network/summary          - Network summary across all racks")
    print(f"  GET  /api/debug/rack/<id>/status   - Debug rack status")
    print(f"  GET  /api/debug                    - Debug information")
    print(f"  POST /api/reload                   - Reload CSV data")
    print(f"{'='*60}")
    
    app.run(host="0.0.0.0", port=10000, debug=True)