# =============================================
# SYSTEM MONITORING MODULE
# Collects detailed metrics using psutil
# With help from copilot.
# =============================================
import psutil
import time
import platform
import socket
from datetime import datetime


def get_advanced_metrics():
    """
    Returns a rich dictionary with system metrics:
    CPU, memory, disk, network, processes, system info.
    """
    
    # ------------------------------
    # CPU METRICS
    # ------------------------------
    cpu_percent_total = psutil.cpu_percent(interval=0.5)
    cpu_per_core = psutil.cpu_percent(interval=0.5, percpu=True)
    load1, load5, load15 = psutil.getloadavg()

    # ------------------------------
    # MEMORY METRICS
    # ------------------------------
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    # ------------------------------
    # DISK METRICS
    # ------------------------------
    disk_usage = {
        partition.mountpoint: psutil.disk_usage(partition.mountpoint)._asdict()
        for partition in psutil.disk_partitions()
    }

    disk_io = psutil.disk_io_counters()._asdict()

    # ------------------------------
    # NETWORK METRICS
    # ------------------------------
    net_io_per_interface = {
        iface: stats._asdict()
        for iface, stats in psutil.net_io_counters(pernic=True).items()
    }

    net_total = psutil.net_io_counters()._asdict()

    # ------------------------------
    # TOP PROCESSES
    # ------------------------------
    processes = []
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
        try:
            processes.append(proc.info)
        except psutil.NoSuchProcess:
            continue

    # Sort by CPU usage (descending)
    processes_sorted = sorted(processes, key=lambda p: p['cpu_percent'], reverse=True)
    top_processes = processes_sorted[:10]  # Top 10

    # ------------------------------
    # SYSTEM INFO
    # ------------------------------
    boot_time = datetime.fromtimestamp(psutil.boot_time()).isoformat()

    system_info = {
        "hostname": socket.gethostname(),
        "os": platform.system(),
        "os_version": platform.version(),
        "uptime_seconds": time.time() - psutil.boot_time(),
        "boot_time": boot_time,
    }

    # ------------------------------
    # BUILD FINAL STRUCTURE
    # ------------------------------
    return {
        "timestamp": datetime.now().isoformat(),

        "cpu": {
            "total_percent": cpu_percent_total,
            "per_core_percent": cpu_per_core,
            "load_avg": {
                "1min": load1,
                "5min": load5,
                "15min": load15
            }
        },

        "memory": {
            "virtual": mem._asdict(),
            "swap": swap._asdict()
        },

        "disk": {
            "usage": disk_usage,
            "io": disk_io
        },

        "network": {
            "total": net_total,
            "per_interface": net_io_per_interface
        },

        "processes": top_processes,

        "system": system_info
    }
