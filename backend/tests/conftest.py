"""pytest 全局配置：测试环境关闭限流 + 使用临时数据库（隔离持久数据）。"""
import os
import tempfile

os.environ["PPC_RATE_LIMIT"] = "0"
os.environ["PPC_DATA_DIR"] = tempfile.mkdtemp(prefix="ppc-test-")
