# Use the full Python image that has gcc + build tools (works on M1/M2/M3 Macs)
FROM python:3.12

WORKDIR /app

# Install build dependencies once (cached)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy your code
COPY . .

# Run
EXPOSE 5000
CMD ["python", "app.py"]