package io.dataflint.example

import org.apache.spark.sql.SparkSession

object IcebergExample extends App{
  val spark = SparkSession
    .builder()
    .appName("Iceberg Example")
    .config("spark.plugins", "io.dataflint.spark.SparkDataflintPlugin")
    .config("spark.dataflint.telemetry.enabled", false)
    .config("spark.ui.port", "10000")
    .config("spark.sql.maxMetadataStringLength", "10000")
    .config("spark.sql.extensions", "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
    .config("spark.sql.catalog.spark_catalog", "org.apache.iceberg.spark.SparkSessionCatalog")
    .config("spark.sql.catalog.spark_catalog.type", "hive")
    .config("spark.sql.catalog.local", "org.apache.iceberg.spark.SparkCatalog")
    .config("spark.sql.catalog.local.type", "hadoop")
    .config("spark.sql.catalog.local.warehouse", "/tmp/iceberg-example/warehouse")
    .config("spark.sql.defaultCatalog", "local")
    .config("spark.sql.catalog.local.metrics-reporter-impl", "org.apache.spark.dataflint.iceberg.DataflintIcebergMetricsReporter")
    .config("spark.eventLog.enabled", "true")
    .master("local[*]")
    .getOrCreate()

  spark.sparkContext.setJobDescription("Drop table if exists")
  spark.sql("DROP TABLE IF EXISTS demo.nyc.taxis PURGE")

  spark.sparkContext.setJobDescription("Create table")
  spark.sql(
    """
      |CREATE TABLE demo.nyc.taxis
      |(
      |  vendor_id bigint,
      |  trip_id bigint,
      |  trip_distance float,
      |  fare_amount double,
      |  store_and_fwd_flag string
      |)
      |PARTITIONED BY (vendor_id);
      |""".stripMargin)

  spark.sparkContext.setJobDescription("Insert 4 records to table")
  spark.sql(
    """
      |INSERT INTO demo.nyc.taxis
      |VALUES (1, 1000371, 1.8, 15.32, 'N'), (2, 1000372, 2.5, 22.15, 'N');
      |""".stripMargin)

  spark.sparkContext.setJobDescription("Insert 4 records to table (2)")
  spark.sql(
    """
      |INSERT INTO demo.nyc.taxis
      |VALUES (1, 1000375, 1.8, 15.32, 'N'), (2, 1000376, 2.5, 22.15, 'N');
      |""".stripMargin)

  spark.sparkContext.setJobDescription("Select from table")
  spark.sql("SELECT * FROM demo.nyc.taxis").show()

  spark.sparkContext.setJobDescription("Update record in table")
  spark.sql(
    """
      |UPDATE demo.nyc.taxis
      |SET fare_amount = 5.0
      |WHERE trip_id = 1000371
      |""".stripMargin)

  spark.sparkContext.setJobDescription("Delete record from table")
  spark.sql(
    """
      |DELETE FROM demo.nyc.taxis
      |WHERE trip_id = 1000371
      |""".stripMargin)

  spark.sparkContext.setJobDescription("Merge all records in table")
  spark.sql(
    """
      MERGE INTO demo.nyc.taxis t USING(SELECT * FROM demo.nyc.taxis) u ON t.trip_id = u.trip_id
      WHEN MATCHED THEN UPDATE SET
      t.fare_amount = t.fare_amount + u.fare_amount
      WHEN NOT MATCHED THEN INSERT *;
    """)

  spark.sparkContext.setJobDescription("Select from table after merge")
  spark.sql("SELECT * FROM demo.nyc.taxis").show()

  spark.sparkContext.setJobDescription("Compaction")
  spark.sql("""
      |CALL local.system.rewrite_data_files(
      |  table => 'demo.nyc.taxis',
      |  strategy => 'sort',
      |  sort_order => 'trip_id ASC NULLS LAST',
      |  options => map(
      |  'rewrite-all','true',
      |  'min-input-files','1',
      |  'rewrite-job-order','bytes-asc',
      |  'target-file-size-bytes','1073741824', -- 1GB
      |  'max-file-group-size-bytes','10737418240' -- 10GB
      |  )
      |)
      |""".stripMargin)


  val currentTimeISO = java.time.format.DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now())
  spark.sparkContext.setJobDescription("Expire snapshots")
  spark.sql(s"""
    CALL local.system.expire_snapshots('demo.nyc.taxis', TIMESTAMP '${currentTimeISO}', 1)
   """)

  scala.io.StdIn.readLine()
}

