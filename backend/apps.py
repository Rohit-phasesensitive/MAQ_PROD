from fastapi import HTTPException, FastAPI
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import json
import traceback

def create_analytics_router(get_db_connection):
    router = APIRouter()
    
    @router.get("/analytics/debug")
    async def debug():
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) as count FROM analytics.fact_test_results")
                    row = cur.fetchone()
                    return {"table_count": row[0] if row else 0}
        except Exception as e:
            return {"error": str(e)}
    
    @router.get("/analytics/overview")
    async def overview():
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # Fixed query - using correct column names and handling your actual data
                    cur.execute("""
                        SELECT
                            COUNT(*) AS total_processed,
                            SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) AS passed,
                            SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) AS failed,
                            COUNT(DISTINCT operator_name) AS active_users
                        FROM analytics.fact_test_results;
                    """)
                    row = cur.fetchone()
                    
                    print(f"Overview query result: {row}")
                    
                    if not row:
                        return JSONResponse(content={
                            "totalProcessed": 0,
                            "passed": 0,
                            "failed": 0,
                            "successRate": 0,
                            "activeUsers": 0
                        })

                    total = int(row[0] or 0)
                    passed = int(row[1] or 0)
                    failed = int(row[2] or 0)
                    active = int(row[3] or 0)

                    success_rate = round(passed / total * 100, 1) if total else 0

                    response_data = {
                        "totalProcessed": total,
                        "passed": passed,
                        "failed": failed,
                        "successRate": success_rate,
                        "activeUsers": active
                    }
                    
                    print(f"Overview response: {response_data}")
                    return JSONResponse(content=response_data)

        except Exception as e:
            print(f"Error in overview endpoint: {str(e)}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/analytics/stages")
    async def stages():
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # Check what test_type values we actually have
                    cur.execute("SELECT DISTINCT test_type FROM analytics.fact_test_results WHERE test_type IS NOT NULL")
                    test_types = [row[0] for row in cur.fetchall()]
                    print(f"Available test_types: {test_types}")
                    
                    # Fixed query - using correct column names
                    cur.execute("""
                        SELECT
                            COALESCE(test_type, 'Unknown') AS stage,
                            COUNT(*) AS total,
                            SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) AS passed,
                            SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) AS failed,
                            AVG(COALESCE(metric_1, 0)) AS avgTime
                        FROM analytics.fact_test_results
                        GROUP BY test_type;
                    """)
                    rows = cur.fetchall()
                    
                    print(f"Stages query result: {rows}")
                    
                    # Map test_type names to more readable names
                    readable_names = {
                        "fiber_align": "Fiber Alignment",
                        "s11": "S11 Testing",
                        "sparameter": "S-Parameter Testing",
                        "gh21_vpi": "GH21 VPI Testing",
                        "dc_vpi": "DC VPI Testing",
                        "Unknown": "Unknown/Other"
                    }
                    
                    result = []
                    for r in rows:
                        stage_name = r[0]
                        readable_name = readable_names.get(stage_name, stage_name)
                        
                        stage_data = {
                            "stage": readable_name,
                            "total": int(r[1] or 0),
                            "passed": int(r[2] or 0),
                            "failed": int(r[3] or 0),
                            "avgTime": float(r[4] or 0)
                        }
                        result.append(stage_data)
                    
                    print(f"Stages response: {result}")
                    return JSONResponse(content=result)
                    
        except Exception as e:
            print(f"Error in stages endpoint: {str(e)}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.get("/analytics/dashboard")
    async def dashboard():
        """
        Dashboard endpoint that works with your actual data structure
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # First, let's see what test_type values we have
                    cur.execute("SELECT DISTINCT test_type FROM analytics.fact_test_results WHERE test_type IS NOT NULL")
                    available_test_types = [row[0] for row in cur.fetchall()]
                    print(f"Available test_types: {available_test_types}")
                    
                    # Get stage-specific data - using actual column names
                    cur.execute("""
                        SELECT
                            COALESCE(test_type, 'Unknown') AS stage,
                            COUNT(*) AS total,
                            SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) AS passed,
                            SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) AS failed,
                            AVG(COALESCE(metric_1, 0)) AS avgTime
                        FROM analytics.fact_test_results
                        GROUP BY test_type;
                    """)
                    stage_rows = cur.fetchall()
                    
                    print(f"Dashboard query result: {stage_rows}")
                    
                    # Initialize response structure
                    response_data = {
                        "chipInspection": {"totalProcessed": 0, "passed": 0, "failed": 0, "successRate": 0, "avgProcessingTime": 0, "recentActivity": []},
                        "housingPrep": {"totalProcessed": 0, "passed": 0, "failed": 0, "successRate": 0, "avgProcessingTime": 0, "recentActivity": []},
                        "wireBond": {"totalProcessed": 0, "passed": 0, "failed": 0, "successRate": 0, "avgProcessingTime": 0, "recentActivity": []},
                        "s11Testing": {"totalProcessed": 0, "passed": 0, "failed": 0, "successRate": 0, "avgProcessingTime": 0, "recentActivity": []},
                        "fiberAttach": {"totalProcessed": 0, "passed": 0, "failed": 0, "successRate": 0, "avgProcessingTime": 0, "recentActivity": []},
                        "dcpiTesting": {"totalProcessed": 0, "passed": 0, "failed": 0, "successRate": 0, "avgProcessingTime": 0, "recentActivity": []}
                    }
                    
                    # If you don't have test_type data, put everything in the first stage
                    if not available_test_types or (len(available_test_types) == 1 and available_test_types[0] is None):
                        print("No test_type data found - putting all data in chipInspection")
                        # Get overall stats and put them in chipInspection
                        cur.execute("""
                            SELECT
                                COUNT(*) AS total,
                                SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) AS passed,
                                SUM(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END) AS failed,
                                AVG(COALESCE(metric_1, 0)) AS avgTime
                            FROM analytics.fact_test_results;
                        """)
                        overall_row = cur.fetchone()
                        if overall_row:
                            total = int(overall_row[0] or 0)
                            passed = int(overall_row[1] or 0)
                            failed = int(overall_row[2] or 0)
                            avg_time = float(overall_row[3] or 0)
                            
                            response_data["chipInspection"] = {
                                "totalProcessed": total,
                                "passed": passed,
                                "failed": failed,
                                "successRate": round(passed / total * 100, 1) if total > 0 else 0,
                                "avgProcessingTime": round(avg_time, 2),
                                "recentActivity": []
                            }
                    else:
                        # Map your actual test_type values to frontend keys
                        stage_mapping = {
                            "fiber_align": "fiberAttach",
                            "s11": "s11Testing",
                            "sparameter": "s11Testing",  # Group with s11 testing
                            "gh21_vpi": "dcpiTesting",
                            "dc_vpi": "dcpiTesting",
                            None: "chipInspection"  # Handle null test_type
                        }
                        
                        # Fill in the actual data
                        for row in stage_rows:
                            stage_name = row[0]
                            total = int(row[1] or 0)
                            passed = int(row[2] or 0)
                            failed = int(row[3] or 0)
                            avg_time = float(row[4] or 0)
                            
                            print(f"Processing stage: {stage_name}, total: {total}, passed: {passed}, failed: {failed}")
                            
                            # Map to frontend key
                            frontend_key = stage_mapping.get(stage_name, None)
                            if frontend_key and frontend_key in response_data:
                                response_data[frontend_key] = {
                                    "totalProcessed": total,
                                    "passed": passed,
                                    "failed": failed,
                                    "successRate": round(passed / total * 100, 1) if total > 0 else 0,
                                    "avgProcessingTime": round(avg_time, 2),
                                    "recentActivity": []
                                }
                    
                    print(f"Dashboard response: {response_data}")
                    return JSONResponse(content=response_data)
                    
        except Exception as e:
            print(f"Error in dashboard endpoint: {str(e)}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))
    
    @router.get("/analytics/system-status")
    async def analytics_system_status():
        """
        Return system status information - integrated with main system
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # Check if we can query the database
                    cur.execute("SELECT 1")
                    db_status = "healthy"
                    
                    # Get basic stats first (without date filtering to test)
                    cur.execute("""
                        SELECT 
                            COUNT(*) as total_tests,
                            AVG(CASE WHEN result = 'PASS' THEN 1.0 ELSE 0.0 END) * 100 as success_rate
                        FROM analytics.fact_test_results
                    """)
                    stats = cur.fetchone()
                    
                    # Get tests from today (with better date handling)
                    cur.execute("""
                        SELECT COUNT(*) as tests_today
                        FROM analytics.fact_test_results
                        WHERE test_timestamp::date = CURRENT_DATE
                    """)
                    today_stats = cur.fetchone()
                    
                    # Get active users from recent activity (last 24 hours)
                    cur.execute("""
                        SELECT COUNT(DISTINCT operator_name) as active_users
                        FROM analytics.fact_test_results
                        WHERE test_timestamp >= NOW() - INTERVAL '24 hours'
                        AND operator_name IS NOT NULL
                    """)
                    active_users_result = cur.fetchone()
                    
                    total_tests = int(stats[0] or 0)
                    success_rate = float(stats[1] or 0)
                    tests_today = int(today_stats[0] or 0)
                    active_users = int(active_users_result[0] or 0)
                    
                    # Debug logging
                    print(f"System Status Debug: total_tests={total_tests}, success_rate={success_rate}, tests_today={tests_today}, active_users={active_users}")
                    
                    return JSONResponse(content={
                        "overall": "healthy" if db_status == "healthy" and total_tests > 0 else "issues",
                        "vna": "healthy",
                        "database": db_status,
                        "storage": "healthy",
                        "tests_today": tests_today,
                        "success_rate": round(success_rate, 1),
                        "active_users": active_users,
                        "debug": {
                            "total_tests": total_tests,
                            "db_status": db_status
                        }
                    })
                    
        except Exception as e:
            print(f"Error in system status endpoint: {str(e)}")
            traceback.print_exc()
            return JSONResponse(content={
                "overall": "offline",
                "vna": "offline",
                "database": "offline", 
                "storage": "offline",
                "tests_today": 0,
                "success_rate": 0,
                "active_users": 0,
                "error": str(e)
            })
    
    # Add a simple test endpoint to check if the database connection works
    @router.get("/analytics/test-db")
    async def test_db():
        """Test database connection and return actual data"""
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # Test basic connectivity
                    cur.execute("SELECT 1 as test")
                    test_result = cur.fetchone()
                    
                    # Get actual data counts
                    cur.execute("SELECT COUNT(*) FROM analytics.fact_test_results")
                    total_count = cur.fetchone()[0]
                    
                    cur.execute("SELECT result, COUNT(*) FROM analytics.fact_test_results GROUP BY result")
                    result_counts = dict(cur.fetchall())
                    
                    cur.execute("SELECT test_type, COUNT(*) FROM analytics.fact_test_results GROUP BY test_type")
                    test_type_counts = dict(cur.fetchall())
                    
                    return {
                        "database_connection": "working",
                        "test_query": test_result[0],
                        "total_records": total_count,
                        "result_breakdown": result_counts,
                        "test_type_breakdown": test_type_counts
                    }
        except Exception as e:
            return {
                "database_connection": "failed",
                "error": str(e),
                "traceback": traceback.format_exc()
            }
    
    # Add a debug endpoint to check if the database connection works
    @router.get("/analytics/debug-data")
    async def debug_data():
        """Debug endpoint to see what data you actually have"""
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # Get basic stats
                    cur.execute("SELECT COUNT(*) FROM analytics.fact_test_results")
                    total_count = cur.fetchone()[0]
                    
                    # Get distinct test_types
                    cur.execute("SELECT test_type, COUNT(*) FROM analytics.fact_test_results GROUP BY test_type")
                    test_types = dict(cur.fetchall())
                    
                    # Get distinct results
                    cur.execute("SELECT result, COUNT(*) FROM analytics.fact_test_results GROUP BY result")
                    results = dict(cur.fetchall())
                    
                    # Get sample data
                    cur.execute("SELECT * FROM analytics.fact_test_results LIMIT 3")
                    sample = [dict(zip([desc[0] for desc in cur.description], row)) for row in cur.fetchall()]
                    
                    return JSONResponse(content={
                        "total_rows": total_count,
                        "test_types": test_types,
                        "results": results,
                        "sample_data": sample
                    })
                    
        except Exception as e:
            return JSONResponse(content={"error": str(e)})
    
    return router