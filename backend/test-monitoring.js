/**
 * Simple test script to verify monitoring system functionality
 * Run with: node test-monitoring.js
 */

const http = require('http');
const { performance } = require('perf_hooks');

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3001',
  dashboardUrl: 'http://localhost:3002',
  testTimeout: 30000 // 30 seconds
};

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Simple HTTP GET request helper
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Test helper function
 */
async function test(name, testFn) {
  const startTime = performance.now();
  console.log(`🧪 Running test: ${name}`);
  
  try {
    await testFn();
    const duration = performance.now() - startTime;
    console.log(`✅ PASS: ${name} (${duration.toFixed(2)}ms)`);
    testResults.passed++;
    testResults.tests.push({ name, status: 'PASS', duration });
  } catch (error) {
    const duration = performance.now() - startTime;
    console.log(`❌ FAIL: ${name} (${duration.toFixed(2)}ms)`);
    console.log(`   Error: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({ name, status: 'FAIL', duration, error: error.message });
  }
}

/**
 * Check if a URL returns expected status
 */
async function checkEndpoint(url, expectedStatus = 200, description = '') {
  try {
    const response = await httpGet(url);
    if (response.statusCode !== expectedStatus) {
      throw new Error(`Expected status ${expectedStatus}, got ${response.statusCode}`);
    }
    return response;
  } catch (error) {
    throw new Error(`${description || 'Endpoint check failed'}: ${error.message}`);
  }
}

/**
 * Check if response contains JSON
 */
function assertJSON(response, description = 'Response should be JSON') {
  try {
    JSON.parse(response.data);
  } catch (error) {
    throw new Error(`${description}: Invalid JSON - ${error.message}`);
  }
}

/**
 * Check if JSON response has expected properties
 */
function assertJSONProperty(response, property, description = '') {
  const data = JSON.parse(response.data);
  if (!(property in data)) {
    throw new Error(`${description || 'JSON property check failed'}: Missing property '${property}'`);
  }
}

/**
 * Main test suite
 */
async function runMonitoringTests() {
  console.log('🚀 Starting Web3 Chat Roulette Monitoring System Tests\n');
  
  // Wait a moment for server to be ready
  console.log('⏳ Waiting for server to be ready...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 1: Basic health check
  await test('Health Check Endpoint', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.baseUrl}/health`, 200, 'Health check failed');
    assertJSON(response, 'Health response should be JSON');
    assertJSONProperty(response, 'status', 'Health response should have status');
  });

  // Test 2: Prometheus metrics
  await test('Prometheus Metrics Endpoint', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.baseUrl}/api/metrics`, 200, 'Metrics endpoint failed');
    if (!response.data.includes('# HELP') || !response.data.includes('# TYPE')) {
      throw new Error('Response does not appear to be Prometheus format');
    }
  });

  // Test 3: Dashboard availability
  await test('Monitoring Dashboard', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.dashboardUrl}/`, 200, 'Dashboard not accessible');
    if (!response.data.includes('Monitoring Dashboard')) {
      throw new Error('Dashboard does not contain expected content');
    }
  });

  // Test 4: Dashboard API
  await test('Dashboard API Data', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.dashboardUrl}/api/dashboard`, 200, 'Dashboard API failed');
    assertJSON(response, 'Dashboard API should return JSON');
    assertJSONProperty(response, 'overview', 'Dashboard should have overview data');
    assertJSONProperty(response, 'metrics', 'Dashboard should have metrics data');
  });

  // Test 5: Health API detailed
  await test('Health API Components', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.dashboardUrl}/api/health`, 200, 'Health API failed');
    assertJSON(response, 'Health API should return JSON');
    const data = JSON.parse(response.data);
    if (!data.components || !Array.isArray(data.components)) {
      throw new Error('Health API should have components array');
    }
  });

  // Test 6: System information
  await test('System Information API', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.dashboardUrl}/api/system`, 200, 'System API failed');
    assertJSON(response, 'System API should return JSON');
    assertJSONProperty(response, 'hostname', 'System info should include hostname');
    assertJSONProperty(response, 'nodeVersion', 'System info should include Node version');
  });

  // Test 7: Alerts API
  await test('Alerts API', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.dashboardUrl}/api/alerts`, 200, 'Alerts API failed');
    assertJSON(response, 'Alerts API should return JSON');
    const data = JSON.parse(response.data);
    if (!Array.isArray(data)) {
      throw new Error('Alerts API should return an array');
    }
  });

  // Test 8: Error tracking API
  await test('Error Tracking API', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.dashboardUrl}/api/errors`, 200, 'Error API failed');
    assertJSON(response, 'Error API should return JSON');
    // This might return 503 if error tracker is not initialized, which is acceptable
    if (response.statusCode === 503) {
      console.log('   ℹ️  Error tracker not yet initialized (acceptable)');
    }
  });

  // Test 9: Metrics JSON format
  await test('Metrics JSON Format', async () => {
    const response = await checkEndpoint(`${TEST_CONFIG.dashboardUrl}/api/metrics/json`, 200, 'Metrics JSON failed');
    assertJSON(response, 'Metrics JSON should return JSON');
    assertJSONProperty(response, 'timestamp', 'Metrics should have timestamp');
  });

  // Test 10: WebRTC stats (if available)
  await test('WebRTC Statistics', async () => {
    try {
      // This might require authentication, so we expect either 200 or 401
      const response = await httpGet(`${TEST_CONFIG.baseUrl}/api/webrtc/stats`);
      if (response.statusCode !== 200 && response.statusCode !== 401) {
        throw new Error(`Unexpected status code: ${response.statusCode}`);
      }
      console.log('   ℹ️  WebRTC stats endpoint responding correctly');
    } catch (error) {
      throw new Error(`WebRTC stats check failed: ${error.message}`);
    }
  });

  // Test Results Summary
  console.log('\n📊 Test Results Summary');
  console.log('========================');
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📈 Total: ${testResults.tests.length}`);
  console.log(`🎯 Success Rate: ${((testResults.passed / testResults.tests.length) * 100).toFixed(1)}%`);

  if (testResults.failed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.tests
      .filter(t => t.status === 'FAIL')
      .forEach(t => console.log(`   - ${t.name}: ${t.error}`));
  }

  // Performance Summary
  const totalDuration = testResults.tests.reduce((sum, t) => sum + t.duration, 0);
  const avgDuration = totalDuration / testResults.tests.length;
  console.log(`\n⏱️  Average test duration: ${avgDuration.toFixed(2)}ms`);
  console.log(`🏃 Total test time: ${totalDuration.toFixed(2)}ms`);

  // Overall result
  const success = testResults.failed === 0;
  console.log(`\n${success ? '🎉' : '💥'} Overall Result: ${success ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  
  if (success) {
    console.log('\n✨ Monitoring system is working correctly!');
    console.log('📊 You can access the dashboard at: http://localhost:3002');
    console.log('📈 Metrics are available at: http://localhost:3001/api/metrics');
  } else {
    console.log('\n🔧 Please check the server logs and fix any issues.');
  }

  return success;
}

/**
 * Main execution
 */
if (require.main === module) {
  runMonitoringTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('💥 Test suite failed to run:', error.message);
      process.exit(1);
    });
}

module.exports = { runMonitoringTests };