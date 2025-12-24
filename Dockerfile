FROM python:3.9-slim

# Install nodejs for http server if needed
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

WORKDIR /app


# Install Python dependencies
RUN pip install pydicom numpy

# Copy web application files
COPY index.html .
COPY app.js .
COPY styles.css .

# Create a simple Python HTTP server to serve the files
EXPOSE 8000

CMD ["python", "-m", "http.server", "8000"]